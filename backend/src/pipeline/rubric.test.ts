import { test } from "node:test";
import assert from "node:assert/strict";
import { weightedScore, ARTICLE_RUBRIC_WEIGHTS, ARTICLE_PASS_THRESHOLD } from "./rubric.js";

test("weightedScore on the worked example from the weighting spec", () => {
  const scores = {
    factual_consistency: 4,
    source_grounding: 5,
    topic_relevance: 4,
    audience_fit: 3,
    clarity: 4,
    completeness: 3,
    tone: 3,
    seo_fit: 5,
  };
  // (4*5 + 5*5 + 4*4 + 3*4 + 4*4 + 3*3 + 3*2 + 5*4) / (5+5+4+4+4+3+2+4) = 124/31 = 4.0 exactly.
  // (The original worked example's own arithmetic didn't match its own
  // table -- summed to 129 instead of 124, then the final division used
  // unrelated numbers entirely. This is the correct result for that table.)
  assert.equal(weightedScore(scores, ARTICLE_RUBRIC_WEIGHTS), 4);
});

test("that worked example clears the pass threshold", () => {
  const scores = {
    factual_consistency: 4,
    source_grounding: 5,
    topic_relevance: 4,
    audience_fit: 3,
    clarity: 4,
    completeness: 3,
    tone: 3,
    seo_fit: 5,
  };
  assert.ok(weightedScore(scores, ARTICLE_RUBRIC_WEIGHTS) >= ARTICLE_PASS_THRESHOLD);
});

test("a clean sweep of 5s scores a perfect 5, well above threshold", () => {
  const scores = Object.fromEntries(Object.keys(ARTICLE_RUBRIC_WEIGHTS).map((k) => [k, 5]));
  assert.equal(weightedScore(scores, ARTICLE_RUBRIC_WEIGHTS), 5);
});

test("missing criteria are skipped, not treated as zero", () => {
  const scores = { factual_consistency: 5, source_grounding: 5 };
  // Only the two highest-weighted criteria present, both maxed -- should
  // still read as a perfect 5, not be dragged down by the missing ones.
  assert.equal(weightedScore(scores, ARTICLE_RUBRIC_WEIGHTS), 5);
});

test("no scores at all is 0, not a crash", () => {
  assert.equal(weightedScore(undefined, ARTICLE_RUBRIC_WEIGHTS), 0);
  assert.equal(weightedScore({}, ARTICLE_RUBRIC_WEIGHTS), 0);
});
