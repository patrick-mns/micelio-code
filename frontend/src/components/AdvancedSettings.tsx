import React, { useState } from 'react';
import { useStore } from '@/store';
import Section from './Section';
import Toggle from './Toggle';
import { theme } from '@/theme';
import { DownloadSimple, ArrowClockwise, Check } from '@phosphor-icons/react';
import UpdateModal from './UpdateModal';
import SandboxSettings from './SandboxSettings';

export default function AdvancedSettings() {
  const { prefs, setPref, update, checkForUpdates, applyUpdate } = useStore();
  const [checking, setChecking] = useState(false);
  const [hasChecked, setHasChecked] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  const handleCheck = async () => {
    setChecking(true);
    setHasChecked(true);
    try {
      await checkForUpdates();
    } catch (e) {
      console.error(e);
    } finally {
      setChecking(false);
    }
  };

  const isDownloading = update.status === 'downloading';
  const isReady = update.status === 'ready';
  const isAvailable = update.status === 'available';

  return (
    <>
    <Section title="ADVANCED">
      <Toggle label="Debug logging" desc="Print raw model requests/responses to stdout" value={prefs.debug} onChange={(v) => setPref('debug', v)} />
    </Section>

    <SandboxSettings />

    <Section title="SOFTWARE UPDATE">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <p style={{ margin: 0, fontSize: 12.5, color: theme.textSoft }}>
          Check for the latest version of Micelio Code manually.
        </p>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 4 }}>
          {/* Main Check Button */}
          <button
            onClick={handleCheck}
            disabled={checking || update.status === 'checking'}
            className="btn btn-sm btn-outline"
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            {checking || update.status === 'checking' ? (
              <>
                <ArrowClockwise size={13} className="spin" />
                Checking...
              </>
            ) : 'Check for Updates'}
          </button>

          {/* Action CTAs depending on state */}
          {isAvailable && (
            <button
              onClick={() => setModalOpen(true)}
              className="btn btn-sm btn-outline"
              style={{ display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <DownloadSimple size={13} />
              Update Available (v{update.version})
            </button>
          )}

          {isDownloading && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: theme.text }}>
              <ArrowClockwise size={13} className="spin" />
              <span>Downloading ({update.progress ?? 0}%)</span>
            </div>
          )}

          {isReady && (
            <button
              onClick={applyUpdate}
              className="btn btn-sm btn-outline"
              style={{ display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <DownloadSimple size={13} />
              Restart to Update
            </button>
          )}

          {/* Up to date feedback */}
          {hasChecked && update.status === 'idle' && !checking && (
            <span style={{ fontSize: 12.5, color: theme.dim, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <Check size={14} color={theme.accent} />
              You are up to date!
            </span>
          )}
        </div>

        {update.status === 'error' && (
          <span style={{ fontSize: 12, color: theme.warn, marginTop: 4 }}>
            Error: {update.error_msg}
          </span>
        )}
      </div>

      {modalOpen && <UpdateModal onClose={() => setModalOpen(false)} />}
    </Section>
    </>
  );
}