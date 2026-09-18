import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Renders article/channel draft bodies as actual formatted markdown (##
 * headings, `code`, lists, etc.) instead of a raw whitespace-pre-wrap text
 * dump. Component overrides are hand-styled with the app's existing design
 * tokens rather than pulling in @tailwindcss/typography.
 */
export function MarkdownBody({ text, className }: { text: string; className?: string }) {
  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => <h1 className="mb-3 mt-5 text-xl font-semibold first:mt-0">{children}</h1>,
          h2: ({ children }) => <h2 className="mb-2 mt-5 text-lg font-semibold first:mt-0">{children}</h2>,
          h3: ({ children }) => <h3 className="mb-2 mt-4 text-base font-semibold first:mt-0">{children}</h3>,
          p: ({ children }) => <p className="mb-3 text-sm leading-relaxed last:mb-0">{children}</p>,
          ul: ({ children }) => <ul className="mb-3 list-disc space-y-1 pl-5 text-sm">{children}</ul>,
          ol: ({ children }) => <ol className="mb-3 list-decimal space-y-1 pl-5 text-sm">{children}</ol>,
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
          blockquote: ({ children }) => (
            <blockquote className="mb-3 border-l-2 border-border pl-3 text-sm text-muted-foreground">
              {children}
            </blockquote>
          ),
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline underline-offset-2 hover:opacity-80"
            >
              {children}
            </a>
          ),
          code: ({ className: codeClassName, children }) => {
            const isBlock = /language-/.test(codeClassName ?? "");
            if (isBlock) {
              return <code className={codeClassName}>{children}</code>;
            }
            return (
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">{children}</code>
            );
          },
          pre: ({ children }) => (
            <pre className="mb-3 overflow-x-auto rounded-md bg-muted/70 p-3 font-mono text-xs leading-relaxed">
              {children}
            </pre>
          ),
          hr: () => <hr className="my-4 border-border" />,
          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
