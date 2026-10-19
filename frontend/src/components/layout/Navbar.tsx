import React, { useState, useEffect } from 'react'
import { NavLink } from 'react-router-dom'
import {
  ShieldCheck,
  GitCompare,
  Sliders,
  Activity,
  FileText,
  Copy,
  Check,
  User,
} from 'lucide-react'
import { recoveryEngine } from '../../recovery/engine'
import { apiClient } from '../../api/client'
import type { NetworkStatus } from '../../recovery/types'

export const Navbar: React.FC = () => {
  const [networkStatus, setNetworkStatus] = useState<NetworkStatus>(recoveryEngine.getNetworkStatus())
  const [hasConflict, setHasConflict] = useState(false)
  const [ownerToken] = useState(apiClient.getOwnerToken())
  const [copiedToken, setCopiedToken] = useState(false)

  useEffect(() => {
    const unsubscribe = recoveryEngine.subscribe((currentDraft, engine) => {
      setNetworkStatus(engine.getNetworkStatus())
      setHasConflict(!!engine.getActiveConflict() || currentDraft?.syncStatus === 'conflict')
    })
    return () => unsubscribe()
  }, [])

  const copyToken = () => {
    navigator.clipboard.writeText(ownerToken)
    setCopiedToken(true)
    setTimeout(() => setCopiedToken(false), 2000)
  }



  return (
    <>
      <header
        style={{
          background: 'var(--bg-surface)',
          borderBottom: '1px solid var(--border-subtle)',
          position: 'sticky',
          top: 0,
          zIndex: 40,
        }}
      >
        <div
          className="container"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            height: '4rem',
          }}
        >
          {/* Logo */}
          <NavLink
            to="/"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.6rem',
              textDecoration: 'none',
              color: 'var(--text-primary)',
            }}
          >
            <div
              style={{
                width: '34px',
                height: '34px',
                borderRadius: 'var(--radius-sm)',
                background: 'linear-gradient(135deg, var(--brand-600), #1d4ed8)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'white',
              }}
            >
              <ShieldCheck size={20} />
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: '1.05rem', lineHeight: 1.2 }}>
                Form<span style={{ color: 'var(--brand-600)' }}>Relay</span>
              </div>
              <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                Offline-First Recovery
              </div>
            </div>
          </NavLink>

          {/* Navigation Links */}
          <nav style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <NavLink
              to="/"
              className={({ isActive }) =>
                `btn btn-sm ${isActive ? 'btn-primary' : 'btn-secondary'}`
              }
            >
              <FileText size={15} />
              <span>Application</span>
            </NavLink>

            <NavLink
              to="/conflict"
              className={({ isActive }) =>
                `btn btn-sm ${isActive ? 'btn-primary' : 'btn-secondary'}`
              }
              style={{ position: 'relative' }}
            >
              <GitCompare size={15} />
              <span>Conflict Resolver</span>
              {hasConflict && (
                <span
                  style={{
                    position: 'absolute',
                    top: '-4px',
                    right: '-4px',
                    background: 'var(--error-500)',
                    color: 'white',
                    fontSize: '0.625rem',
                    fontWeight: 700,
                    width: '16px',
                    height: '16px',
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  !
                </span>
              )}
            </NavLink>

            <NavLink
              to="/migration"
              className={({ isActive }) =>
                `btn btn-sm ${isActive ? 'btn-primary' : 'btn-secondary'}`
              }
            >
              <Sliders size={15} />
              <span>Schema v1→v2</span>
            </NavLink>

            <NavLink
              to="/laboratory"
              className={({ isActive }) =>
                `btn btn-sm ${isActive ? 'btn-primary' : 'btn-secondary'}`
              }
            >
              <ShieldCheck size={15} />
              <span>Failure Lab</span>
            </NavLink>

            <NavLink
              to="/observability"
              className={({ isActive }) =>
                `btn btn-sm ${isActive ? 'btn-primary' : 'btn-secondary'}`
              }
            >
              <Activity size={15} />
              <span>Observability</span>
            </NavLink>
          </nav>

          {/* Right Status Badges */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            {/* Live Network Status */}
            <div
              className={`badge ${
                networkStatus === 'online' ? 'badge-success' : 'badge-warning'
              }`}
              title="Real-time connectivity with backend verified via heartbeat"
            >
              <span
                className={`status-dot ${
                  networkStatus === 'online' ? 'status-dot-green' : 'status-dot-amber'
                }`}
              />
              <span style={{ textTransform: 'capitalize' }}>{networkStatus}</span>
            </div>

            {/* Owner Token Pill */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.3rem',
                background: 'var(--bg-subtle)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-sm)',
                padding: '0.2rem 0.5rem',
                fontSize: '0.75rem',
              }}
              title="Your client owner token for draft isolation"
            >
              <User size={13} style={{ color: 'var(--text-muted)' }} />
              <span style={{ fontFamily: 'var(--font-mono)' }}>
                {ownerToken.slice(0, 8)}...
              </span>
              <button
                type="button"
                onClick={copyToken}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--text-muted)',
                  display: 'flex',
                  alignItems: 'center',
                  padding: '2px',
                }}
                title="Copy Owner Token"
              >
                {copiedToken ? <Check size={12} color="var(--success-500)" /> : <Copy size={12} />}
              </button>
            </div>
          </div>
        </div>
      </header>
    </>
  )
}
