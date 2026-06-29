import React, { useState, type CSSProperties } from 'react';
import { toolEntryStyles } from '@/utils/theme-styles';
import {
  CaretRight, Check, Terminal, FileText, MagnifyingGlass,
  PencilSimple, FilePlus, Folder, Wrench, GlobeSimple, GitBranch,
  type Icon,
} from '@phosphor-icons/react';
import { theme } from '@/theme';

// Map a tool name to an icon for quick visual scanning.
function toolIcon(name: string): Icon {
  const n = name.toLowerCase();
  if (n.includes('bash') || n.includes('shell') || n.includes('exec') || n.includes('terminal') || n.includes('run')) return Terminal;
  if (n.includes('search') || n.includes('grep') || n.includes('find') || n.includes('glob')) return MagnifyingGlass;
  if (n.includes('git')) return GitBranch;
  if (n.includes('ls') || n.includes('list') || n.includes('dir')) return Folder;
  if (n.includes('fetch') || n.includes('web') || n.includes('http')) return GlobeSimple;
  // `file` tool: pick by the action implied in the breadcrumb/stats later.
  if (n.includes('read') || n.includes('cat') || n.includes('view')) return FileText;
  if (n.includes('edit') || n.includes('replace')) return PencilSimple;
  if (n.includes('write') || n.includes('create')) return FilePlus;
  if (n.includes('file')) return FileText;
  return Wrench;
}

// Single tool call: a borderless row (icon + name + breadcrumb + stats) with a
// collapsible detail. Content arrives as "<name> completed\n[path +N -M]\n<body>".
interface ToolEntryProps {
  content: string;
  showDetails?: boolean;
  nested?: boolean;
}

export default function ToolEntry({ content, showDetails = true, nested = false }: ToolEntryProps) {
  const [open, setOpen] = useState(false);
  const lines = content.split('\n');
  let summary = lines[0] || 'tool';
  let breadcrumb = null;
  let added = 0, removed = 0;
  let detailStart = 1;

  const bcLine = lines[1] || '';
  const breadcrumbMatch = bcLine.match(/^\[([^\]]+)\]$/);
  if (breadcrumbMatch) {
    const fullBreadcrumb = breadcrumbMatch[1];
    const statsMatch = fullBreadcrumb.match(/^(.*?)\s*\+(\d+)\s*-(\d+)$/);
    if (statsMatch) {
      breadcrumb = statsMatch[1];
      added = parseInt(statsMatch[2]);
      removed = parseInt(statsMatch[3]);
    } else {
      breadcrumb = fullBreadcrumb;
    }
    detailStart = 2;
  }

  const detail = lines.slice(detailStart).join('\n').trim();
  const isRunning = summary.includes(' running');
  const name = summary.replace(' completed', '').replace(' running', '').trim();
  // A diff (added/removed) means an edit; a write with no removals is a create.
  const hasDiff = added > 0 || removed > 0;
  const Icon = name === 'file' && hasDiff ? PencilSimple
    : name === 'file' && breadcrumb ? FilePlus
    : toolIcon(name);
  const detailLines = detail ? detail.split('\n') : [];
  const hasDetail = showDetails && detail;

  return (
    <div style={toolEntryStyles.wrap}>
      <button
        className="tool-row"
        onClick={() => hasDetail && setOpen(!open)}
        style={{ ...toolEntryStyles.row, cursor: hasDetail ? 'pointer' : 'default' }}
      >
        <CaretRight
          size={10}
          color={theme.faint}
          style={{
            transform: open ? 'rotate(90deg)' : 'none',
            transition: 'transform 0.12s',
            flexShrink: 0,
            opacity: hasDetail ? 1 : 0,
          }}
        />
        <Icon size={13} color={theme.dim} weight="regular" style={{ flexShrink: 0 }} />
        <span style={toolEntryStyles.name}>{name}</span>
        {breadcrumb && <span style={toolEntryStyles.breadcrumb}>{breadcrumb}</span>}
        {hasDiff && (
          <span style={toolEntryStyles.stats}>
            {added > 0 && <span style={toolEntryStyles.added}>+{added}</span>}
            {removed > 0 && <span style={toolEntryStyles.removed}>−{removed}</span>}
          </span>
        )}
        <div style={{ flex: 1 }} />
        {isRunning
          ? <span style={toolEntryStyles.spinner} />
          : <Check size={12} color={theme.faint} weight="bold" />}
      </button>

      {hasDetail && open && (
        <div className="tool-detail" style={toolEntryStyles.detail}>
          {detailLines.map((line, i) => {
            const isRemoved = line.startsWith('- ');
            const isAdded = line.startsWith('+ ');
            const isContext = line.startsWith('  ');
            const isDiffHeader = line.startsWith('---') || line.startsWith('+++');
            const body = line.slice(2);

            if (isDiffHeader) return null; // redundant with the breadcrumb

            if (isRemoved) return (
              <div key={i} style={toolEntryStyles.lineRemoved}>
                <span style={toolEntryStyles.markerMinus}>−</span>
                <span style={toolEntryStyles.lineBody}>{body}</span>
              </div>
            );
            if (isAdded) return (
              <div key={i} style={toolEntryStyles.lineAdded}>
                <span style={toolEntryStyles.markerPlus}>+</span>
                <span style={toolEntryStyles.lineBody}>{body}</span>
              </div>
            );
            if (isContext) return (
              <div key={i} style={toolEntryStyles.lineContext}>
                <span style={toolEntryStyles.markerCtx}> </span>
                <span style={toolEntryStyles.lineBody}>{body}</span>
              </div>
            );
            return <div key={i} style={toolEntryStyles.plainLine}>{line}</div>;
          })}
        </div>
      )}
    </div>
  );
}

// Group of consecutive tool calls under one "Ran N tools" toggle.
interface ToolGroupProps {
  tools: string[];
  showDetails?: boolean;
}

export function ToolGroup({ tools, showDetails }: ToolGroupProps) {
  const [open, setOpen] = useState(false);
  return (
    <div style={toolEntryStyles.groupWrap}>
      <button className="tool-row" onClick={() => setOpen(!open)} style={{ ...toolEntryStyles.row, cursor: 'pointer' }}>
        <CaretRight
          size={10}
          color={theme.faint}
          style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.12s', flexShrink: 0 }}
        />
        <Wrench size={13} color={theme.dim} style={{ flexShrink: 0 }} />
        <span style={toolEntryStyles.groupName}>Ran {tools.length} tools</span>
      </button>
      {open && (
        <div className="tool-tree" style={toolEntryStyles.groupBody}>
          {tools.map((t, i) => (
            <div className="tool-tree-item" key={i}>
              <ToolEntry content={t} showDetails={showDetails} nested />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const MONO = 'ui-monospace, SFMono-Regular, monospace';
