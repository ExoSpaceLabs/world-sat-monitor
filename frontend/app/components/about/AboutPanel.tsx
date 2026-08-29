"use client";

import {useState} from "react";
import {APPLICATION_INFO} from "../../domain/application";

export function AboutControl() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className={`about-trigger ${open ? "active" : ""}`}
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-controls="worldsat-about-panel"
      >
        ABOUT
      </button>
      {open && (
        <aside id="worldsat-about-panel" className="about-panel" aria-label="About WorldSat Monitor">
          <header className="about-head">
            <div>
              <small>EXOSPACELABS</small>
              <strong>{APPLICATION_INFO.name}</strong>
            </div>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close about panel">×</button>
          </header>
          <div className="about-body">
            <p>{APPLICATION_INFO.description}</p>
            <dl>
              <div><dt>VERSION</dt><dd>v{APPLICATION_INFO.version}</dd></div>
              <div><dt>PROJECT</dt><dd>{APPLICATION_INFO.owner}</dd></div>
              <div><dt>REPOSITORY</dt><dd><a href={APPLICATION_INFO.repository} target="_blank" rel="noreferrer">GitHub / world-sat-monitor</a></dd></div>
              <div><dt>CONTACT</dt><dd><a href={`mailto:${APPLICATION_INFO.email}`}>{APPLICATION_INFO.email}</a></dd></div>
            </dl>
            <div className="about-stack">SELF-HOSTED · SERVICE-ORIENTED · SGP4 · POSTGRESQL · MAPLIBRE</div>
          </div>
        </aside>
      )}
    </>
  );
}
