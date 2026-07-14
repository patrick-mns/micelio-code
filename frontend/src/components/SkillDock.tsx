import React, { useEffect, useState, useCallback, useRef } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { ipc } from '@/ipc';
import { useStore } from '@/store';
import type { SkillSummary } from '@/types';
import { skillIconForName, skillInitials } from '@/utils/skillIcons';
import SkillModal from '@/components/SkillModal';

interface SkillDockProps {
  workspaceRoot: string | null;
}

const BASE_SIZE = 28;
const MAX_SIZE = 52;
const GAP = 4;
const MAGNET_RADIUS = 96;
const DOCK_PAD_Y = 4;

export default function SkillDock({ workspaceRoot }: SkillDockProps) {
  const skills = useStore((s) => s.skills);
  const setSkills = useStore((s) => s.setSkills);
  const [loading, setLoading] = useState(false);
  const [inspecting, setInspecting] = useState<SkillSummary | null>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const btnRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const mouseX = useRef<number | null>(null);
  const rafId = useRef(0);

  useEffect(() => {
    if (!workspaceRoot) {
      setSkills([]);
      return;
    }
    setLoading(true);
    ipc
      .loadSkills(workspaceRoot)
      .then(() => ipc.listSkills())
      .then((list) => setSkills(list))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [workspaceRoot]);

  // macOS Dock model: icons change their REAL width/height with a cosine
  // falloff of cursor distance; flexbox reflows the row (bottom-anchored),
  // so neighbors slide apart naturally — no translate math, no feedback loop.
  // Sizes are written imperatively (outside React state) so the loop stays
  // at 60fps without re-renders.
  const applySizes = useCallback(() => {
    const mx = mouseX.current;
    btnRefs.current.forEach((btn) => {
      let size = BASE_SIZE;
      if (mx != null) {
        const rect = btn.getBoundingClientRect();
        const dist = Math.abs(mx - (rect.left + rect.width / 2));
        if (dist < MAGNET_RADIUS) {
          const bump = (Math.cos((dist / MAGNET_RADIUS) * Math.PI) + 1) / 2;
          size = BASE_SIZE + (MAX_SIZE - BASE_SIZE) * bump;
        }
      }
      btn.style.width = `${size}px`;
      btn.style.height = `${size}px`;
      const inner = btn.querySelector<HTMLElement>('.dock-icon-inner');
      if (inner) inner.style.transform = `scale(${size / BASE_SIZE})`;
    });
  }, []);

  // Run a settle loop while hovering: sizes shift centers, so a single pass
  // per mousemove converges late — iterating each frame tracks the cursor.
  const startLoop = useCallback(() => {
    cancelAnimationFrame(rafId.current);
    const tick = () => {
      applySizes();
      rafId.current = requestAnimationFrame(tick);
    };
    rafId.current = requestAnimationFrame(tick);
  }, [applySizes]);

  const stopLoop = useCallback(() => {
    cancelAnimationFrame(rafId.current);
    rafId.current = 0;
    mouseX.current = null;
    applySizes(); // reset to base (CSS transition eases it back)
  }, [applySizes]);

  useEffect(() => () => cancelAnimationFrame(rafId.current), []);

  if (!workspaceRoot) return null;
  if (skills.length === 0 && loading) return null;

  return (
    <div style={{ display: 'flex', justifyContent: 'center', overflow: 'visible' }}>
      {skills.length === 0 && !loading ? (
        <span style={{ color: 'var(--color-dim)', fontSize: 12, fontStyle: 'italic' }}>
          No skills — create one in .micelio/skills/
        </span>
      ) : (
        <div
          ref={dockRef}
          onMouseEnter={(e) => {
            mouseX.current = e.clientX;
            startLoop();
          }}
          onMouseMove={(e) => {
            mouseX.current = e.clientX;
          }}
          onMouseLeave={stopLoop}
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            gap: GAP,
            padding: `${DOCK_PAD_Y}px 6px`,
            // Fixed height: magnified icons overflow upward instead of
            // pushing the composer around.
            height: BASE_SIZE + DOCK_PAD_Y * 2,
            overflow: 'visible',
            whiteSpace: 'nowrap',
            background: 'transparent',
          }}
        >
          {skills.map((s) => (
            <DockIcon
              key={s.name}
              skill={s}
              active={s.enabled}
              onOpen={setInspecting}
              registerRef={(el) => {
                if (el) btnRefs.current.set(s.name, el);
                else btnRefs.current.delete(s.name);
              }}
            />
          ))}
        </div>
      )}
      {inspecting && (
        <SkillModal
          // Re-read from the store so the modal reflects live enabled state
          skill={skills.find((s) => s.name === inspecting.name) ?? inspecting}
          onClose={() => setInspecting(null)}
        />
      )}
    </div>
  );
}

/** Render icon: 1) file icon  → 2) Lucide  → 3) initials */
function renderIcon(skill: SkillSummary) {
  const iconPath = skill.icon_path;
  if (iconPath && iconPath.length > 0) {
    return (
      <img
        src={convertFileSrc(iconPath)}
        alt=""
        style={{ width: 16, height: 16, display: 'block', objectFit: 'contain' }}
        onError={(e) => {
          (e.target as HTMLImageElement).style.display = 'none';
        }}
      />
    );
  }

  const LucideIcon = skillIconForName(skill.name);
  if (LucideIcon) {
    return (
      <span
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--color-text)',
        }}
      >
        {React.createElement(LucideIcon, { size: 16, strokeWidth: 1.5 })}
      </span>
    );
  }

  // Fallback: initials
  return (
    <span
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: '0.02em',
        color: 'var(--color-dim)',
        lineHeight: 1,
      }}
    >
      {skillInitials(skill.display_name)}
    </span>
  );
}

function DockIcon({
  skill,
  active,
  onOpen,
  registerRef,
}: {
  skill: SkillSummary;
  active: boolean;
  onOpen: (skill: SkillSummary) => void;
  registerRef: (el: HTMLButtonElement | null) => void;
}) {
  return (
    <div
      className="dock-icon-wrapper"
      style={{ position: 'relative', display: 'flex', alignItems: 'flex-end' }}
    >
      <button
        ref={registerRef}
        onClick={() => onOpen(skill)}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData('application/x-micelio-skill', skill.name);
          e.dataTransfer.setData('text/plain', `#${skill.name}`);
          e.dataTransfer.effectAllowed = 'copy';
        }}
        aria-label={skill.display_name}
        style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: BASE_SIZE,
          height: BASE_SIZE,
          borderRadius: '28%',
          border: '1px solid var(--color-border)',
          background: 'var(--color-card)',
          boxShadow: '0 1px 2px rgba(0,0,0,0.12), 0 2px 5px rgba(0,0,0,0.06)',
          cursor: 'pointer',
          flexShrink: 0,
          padding: 0,
          // Eases both growth under the cursor and the snap-back on leave;
          // short enough that tracking feels immediate.
          transition: 'width 90ms ease-out, height 90ms ease-out, opacity 0.15s ease',
          willChange: 'width, height',
          // Disabled skills sit dimmed in the dock; no badge needed.
          opacity: active ? 1 : 0.4,
        }}
      >
        <span
          className="dock-icon-inner"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'transform 90ms ease-out',
            willChange: 'transform',
          }}
        >
          {renderIcon(skill)}
        </span>
      </button>

      {/* Hover label — wrapper grows with the button, so left:50% keeps it
          centered with no manual offset. Follows the project tooltip style. */}
      <span
        className="dock-label"
        style={{
          position: 'absolute',
          bottom: 'calc(100% + 8px)',
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'var(--color-card)',
          border: '1px solid var(--color-border)',
          color: 'var(--color-text)',
          fontSize: 12,
          fontWeight: 500,
          padding: '4px 10px',
          borderRadius: 'var(--radius-md)',
          whiteSpace: 'nowrap',
          pointerEvents: 'none',
          opacity: 0,
          transition: 'opacity 0.1s ease',
          boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
          zIndex: 9999,
        }}
      >
        {skill.display_name}
      </span>
    </div>
  );
}
