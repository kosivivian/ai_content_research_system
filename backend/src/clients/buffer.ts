import { loadEnv } from "../config/env.js";

// Buffer's classic REST API (api.bufferapp.com/1/...) this client was
// originally built against is deprecated (sunset 2027-02-01) and, as of
// this rewrite, already rejects this project's access token outright
// ("Public API tokens are not accepted for REST API access") -- confirmed
// live against Buffer's real API, along with everything below, via GraphQL
// introspection (__schema) rather than guessed from docs. Auth is a plain
// `Authorization: Bearer <token>` header against one endpoint; the same
// BUFFER_ACCESS_TOKEN works for this without changing its value.
//
// Terminology shift: a "profile" (classic REST) is now called a "channel"
// (GraphQL) -- BUFFER_PROFILE_ID_LINKEDIN/_X should hold a `channelId`
// from Buffer's `channels` query, not the old REST profile id.

const GRAPHQL_ENDPOINT = "https://api.buffer.com";

interface GraphQLError {
  message: string;
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: GraphQLError[];
}

async function graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const env = loadEnv();
  const res = await fetch(GRAPHQL_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.BUFFER_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({ query, variables }),
  });

  const json = (await res.json()) as GraphQLResponse<T>;
  if (!res.ok || (json.errors && json.errors.length > 0)) {
    const message = json.errors?.map((e) => e.message).join("; ") ?? res.statusText;
    throw new Error(`Buffer GraphQL request failed (${res.status}): ${message}`);
  }
  if (!json.data) {
    throw new Error("Buffer GraphQL request returned no data");
  }
  return json.data;
}

interface BufferUpdate {
  id: string;
  status: string;
}

const CREATE_POST_MUTATION = `
  mutation CreatePost($input: CreatePostInput!) {
    createPost(input: $input) {
      __typename
      ... on PostActionSuccess { post { id status } }
      ... on InvalidInputError { message }
      ... on NotFoundError { message }
      ... on UnauthorizedError { message }
      ... on UnexpectedError { message }
      ... on LimitReachedError { message }
      ... on RestProxyError { message code }
    }
  }
`;

interface CreatePostResult {
  createPost: {
    __typename: string;
    message?: string;
    post?: { id: string; status: string };
  };
}

/**
 * `profileId` is Buffer's `channelId` in the current API (the GraphQL
 * schema renamed "profile" to "channel"; the parameter name here is kept
 * so publishingDeps.ts/publishingLoop.ts didn't need to change).
 */
export async function createUpdate(params: {
  profileId: string;
  text: string;
  scheduledAt?: Date;
}): Promise<BufferUpdate> {
  const input: Record<string, unknown> = {
    channelId: params.profileId,
    text: params.text,
    needsApproval: false,
    assets: [],
    schedulingType: "automatic",
    ...(params.scheduledAt
      ? { mode: "customScheduled", dueAt: params.scheduledAt.toISOString() }
      : { mode: "shareNow" }),
  };

  const data = await graphql<CreatePostResult>(CREATE_POST_MUTATION, { input });
  const result = data.createPost;

  if (result.__typename !== "PostActionSuccess" || !result.post) {
    throw new Error(`Buffer createPost failed (${result.__typename}): ${result.message ?? "unknown error"}`);
  }

  return result.post;
}

const GET_POST_QUERY = `
  query GetPost($input: PostInput!) {
    post(input: $input) { id status }
  }
`;

export async function getUpdateStatus(updateId: string): Promise<BufferUpdate> {
  const data = await graphql<{ post: BufferUpdate }>(GET_POST_QUERY, { input: { id: updateId } });
  return data.post;
}

const CHANNELS_QUERY = `
  query Channels($input: ChannelsInput!) {
    channels(input: $input) { id name displayName service isDisconnected }
  }
`;

export interface BufferChannelInfo {
  id: string;
  name: string;
  displayName: string | null;
  service: string;
  isDisconnected: boolean;
}

/**
 * Lists every channel connected to the account that owns BUFFER_ACCESS_TOKEN,
 * across all of its organizations. Not called by the pipeline -- this is
 * for discovering the channelId to put in BUFFER_PROFILE_ID_LINKEDIN/_X
 * (see backend/scripts/list-buffer-channels.ts), since Buffer's dashboard
 * doesn't surface the raw id directly.
 */
export async function listChannels(): Promise<BufferChannelInfo[]> {
  const account = await graphql<{ account: { organizations: { id: string }[] } }>(
    `query { account { organizations { id } } }`,
    {},
  );

  const results: BufferChannelInfo[] = [];
  for (const org of account.account.organizations) {
    const data = await graphql<{ channels: BufferChannelInfo[] }>(CHANNELS_QUERY, {
      input: { organizationId: org.id },
    });
    results.push(...data.channels);
  }
  return results;
}
