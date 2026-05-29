import { memo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Renders model output as GitHub-flavored markdown.
 *
 * Raw HTML in the source is NOT rendered — react-markdown's default escapes
 * it. We pass remark-gfm for tables / task lists / strikethrough / autolinks.
 *
 * `inline` mode skips block wrappers (paragraphs, headings) and renders the
 * source as a single inline run — useful for short notice strings inside
 * already-block-level containers like dialogs.
 */
export interface RichTextProps {
  text?: string;
  inline?: boolean;
}

const COMPONENTS: Components = {
  // Match the existing inline-code styling token.
  code({ className, children, ...rest }) {
    const isBlock = /language-/.test(className ?? "");
    if (isBlock) {
      return (
        <code className={"md-codeblock-inner mono " + (className ?? "")} {...rest}>
          {children}
        </code>
      );
    }
    return (
      <code className="inlinecode" {...rest}>
        {children}
      </code>
    );
  },
  pre({ children, ...rest }) {
    return (
      <pre className="md-codeblock mono" {...rest}>
        {children}
      </pre>
    );
  },
  a({ href, children, ...rest }) {
    return (
      <a href={href} target="_blank" rel="noreferrer noopener" {...rest}>
        {children}
      </a>
    );
  },
};

function RichTextImpl({ text, inline }: RichTextProps) {
  if (!text) return null;
  if (inline) {
    // Strip surrounding paragraph wrapper so the content flows inline.
    return (
      <span className="md-inline">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={INLINE_COMPONENTS}>
          {text}
        </ReactMarkdown>
      </span>
    );
  }
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
        {text}
      </ReactMarkdown>
    </div>
  );
}

// Inline variant: unwrap paragraphs so a single-line message doesn't get a
// trailing block margin. Everything else still renders normally.
const INLINE_COMPONENTS: Components = {
  ...COMPONENTS,
  p({ children }) {
    return <>{children}</>;
  },
};

export const RichText = memo(RichTextImpl);

export const Caret = () => <span className="caret" />;
