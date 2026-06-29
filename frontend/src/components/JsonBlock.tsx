import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import json from 'react-syntax-highlighter/dist/esm/languages/prism/json';

SyntaxHighlighter.registerLanguage('json', json);

interface JsonBlockProps {
  content: string;
  className?: string;
}

export default function JsonBlock({ content, className = '' }: JsonBlockProps) {
  return (
    <SyntaxHighlighter
      language="json"
      style={oneDark}
      wrapLongLines={false}
      // A self-contained dark code surface (--color-code-bg stays dark in both
      // themes, so oneDark's syntax colors keep contrast). codeTagProps clears
      // the theme's own <code> background so there's no tight dark band inside a
      // lighter container.
      customStyle={{
        margin: 0,
        padding: '10px 12px',
        background: 'var(--color-code-bg)',
        borderRadius: 'var(--radius-sm)',
        fontSize: '12px',
        overflowX: 'auto',
      }}
      codeTagProps={{ style: { background: 'transparent', fontFamily: 'ui-monospace, SFMono-Regular, monospace' } }}
      className={className}
    >
      {content}
    </SyntaxHighlighter>
  );
}
