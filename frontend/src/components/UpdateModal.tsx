import React, { useEffect, useState } from 'react';
import { X, Download, ArrowClockwise } from '@phosphor-icons/react';
import { theme } from '@/theme';
import { useStore } from '@/store';
import { ipc } from '@/ipc';
import Modal from '@/components/Modal';
import ReactMarkdown from 'react-markdown';
import { mdComponents } from '@/components/MdComponents';

interface UpdateModalProps {
  onClose: () => void;
}

export default function UpdateModal({ onClose }: UpdateModalProps) {
  const { update, startDownload, applyUpdate } = useStore();
  const [currentVersion, setCurrentVersion] = useState<string>('');

  useEffect(() => {
    ipc.getAppVersion().then(setCurrentVersion).catch(console.error);
  }, []);

  const progress = update.progress ?? 0;
  const isDownloading = update.status === 'downloading';
  const isReady = update.status === 'ready';
  const isAvailable = update.status === 'available';

  return (
    <Modal
      onClose={onClose}
      cardStyle={{
        width: 'min(500px, 92vw)',
        maxHeight: 'min(640px, 85vh)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 12px 0' }}>
          <span style={{ fontSize: 16, fontWeight: 600, color: theme.text }}>Software Update</span>
          <button className="close-btn" onClick={onClose} title="Close (Esc)">
            <X size={15} />
          </button>
        </div>

        {/* Version comparison — centered card */}
        <div style={{
          margin: '8px 12px 12px',
          padding: '12px 12px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 20,
          background: theme.bgDeep,
          borderRadius: 'var(--radius-lg)',
          border: `1px solid ${theme.border}`,
        }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 10.5, textTransform: 'uppercase', color: theme.dim, fontWeight: 500, marginBottom: 3 }}>Current</div>
            <div style={{ fontSize: 14, color: theme.textSoft, fontFamily: 'ui-monospace, monospace' }}>v{currentVersion || '...'}</div>
          </div>
          <div style={{ fontSize: 11, color: theme.dim, fontFamily: 'ui-monospace, monospace', padding: '0 4px' }}>→</div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 10.5, textTransform: 'uppercase', color: theme.accent, fontWeight: 500, marginBottom: 3 }}>Latest</div>
            <div style={{ fontSize: 14, color: theme.accent, fontWeight: 600, fontFamily: 'ui-monospace, monospace' }}>v{update.version}</div>
          </div>
        </div>

        {/* Change notes - scrollable */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 12px 12px', fontSize: 13.5, lineHeight: 1.6, color: theme.textSoft }}>
          <div className="markdown-body" style={{ fontSize: 13 }}>
            {update.notes ? (
              <ReactMarkdown components={mdComponents}>{update.notes}</ReactMarkdown>
            ) : (
              <em style={{ color: theme.dim }}>No release notes provided.</em>
            )}
          </div>
        </div>

        {/* Action area */}
        <div style={{ padding: '12px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* Download progress */}
          {isDownloading && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: theme.dim }}>
                <span>Downloading update...</span>
                <span>{progress}%</span>
              </div>
              <div style={{ height: 6, background: theme.border, borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${progress}%`, background: theme.accent, borderRadius: 3, transition: 'width 0.15s ease' }} />
              </div>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, alignItems: 'center' }}>
            <button className="btn btn-md btn-outline" onClick={onClose} disabled={isDownloading}>
              Later
            </button>

            {isAvailable && (
              <button className="btn btn-md btn-solid" style={{ gap: 6 }} onClick={startDownload}>
                <Download size={13} weight="bold" /> Download and Install
              </button>
            )}

            {isDownloading && (
              <button className="btn btn-md btn-solid" disabled style={{ gap: 6 }}>
                <ArrowClockwise size={13} className="spin" /> Downloading...
              </button>
            )}

            {isReady && (
              <button className="btn btn-md btn-solid" style={{ gap: 6 }} onClick={applyUpdate}>
                Restart and Update
              </button>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}