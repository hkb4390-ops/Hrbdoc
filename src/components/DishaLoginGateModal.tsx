import React, { useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Eye,
  EyeOff,
  FileText,
  KeyRound,
  Loader2,
  Lock,
  Phone,
  PlayCircle,
  ShieldCheck,
  UserCheck,
} from 'lucide-react';
import { loginDishaDirect, saveDishaCreds } from '../lib/dishaApi';

interface DishaLoginGateModalProps {
  logoUrl: string;
  onLoggedIn: () => void;
}

export const DishaLoginGateModal: React.FC<DishaLoginGateModalProps> = ({
  logoUrl,
  onLoggedIn,
}) => {
  const [authMode, setAuthMode] = useState<'credentials' | 'token'>('credentials');
  const [phoneInput, setPhoneInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [userIdInput, setUserIdInput] = useState('');
  const [tokenInput, setTokenInput] = useState('');

  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setStatusMsg(null);
    setLoading(true);
    try {
      if (authMode === 'credentials') {
        await loginDishaDirect(phoneInput, passwordInput);
        setStatusMsg({
          type: 'ok',
          text: 'Disha account verified! Opening GB STUDY...',
        });
        window.setTimeout(() => {
          onLoggedIn();
        }, 400);
      } else {
        const cleanUid = userIdInput.trim();
        const cleanTok = tokenInput.trim();
        if (!cleanUid || cleanTok.length < 25) {
          setStatusMsg({
            type: 'err',
            text: 'Please enter a valid Disha User ID and JWT Token.',
          });
          setLoading(false);
          return;
        }
        const checkRes = await fetch('/api/public/disha-record', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: cleanUid, token: cleanTok }),
        });
        const checkJson = await checkRes.json().catch(() => null);
        if (!checkRes.ok || !checkJson?.success) {
          throw new Error(checkJson?.error || 'Invalid Disha User ID or JWT Token.');
        }
        saveDishaCreds({
          userId: cleanUid,
          token: cleanTok,
          name: checkJson?.data?.name || '',
        });
        setStatusMsg({
          type: 'ok',
          text: 'Disha token verified! Opening GB STUDY...',
        });
        window.setTimeout(() => {
          onLoggedIn();
        }, 400);
      }
    } catch (err: any) {
      setStatusMsg({
        type: 'err',
        text: err?.message || 'Disha login failed. Check your details.',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center overflow-y-auto bg-[#060913] text-slate-100 p-4 sm:p-6">
      {/* Layered Ambient Canvas */}
      <div
        className="pointer-events-none fixed inset-0"
        style={{
          backgroundImage:
            'radial-gradient(ellipse 65% 55% at 15% 10%, rgba(90,75,218,0.28), transparent 60%), radial-gradient(ellipse 55% 50% at 88% 92%, rgba(245,158,11,0.16), transparent 58%), linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px)',
          backgroundSize: '100% 100%, 100% 100%, 40px 40px, 40px 40px',
        }}
      />

      {/* Split Editorial Auth Surface */}
      <div className="relative z-10 w-full max-w-[820px] overflow-hidden rounded-3xl border border-white/10 bg-[#0d1220]/95 shadow-[0_30px_90px_-20px_rgba(0,0,0,0.85)] backdrop-blur-xl md:grid md:grid-cols-12">
        {/* Left Brand Showcase Panel */}
        <div className="relative hidden md:col-span-5 md:flex md:flex-col md:justify-between border-r border-white/10 bg-gradient-to-br from-[#131932] via-[#0e1428] to-[#0a0e1b] p-8 overflow-hidden">
          <div
            className="pointer-events-none absolute -top-24 -left-24 h-64 w-64 rounded-full opacity-40 blur-3xl"
            style={{ background: 'radial-gradient(circle, #5a4bda 0%, transparent 70%)' }}
          />
          <div
            className="pointer-events-none absolute -bottom-24 -right-16 h-56 w-56 rounded-full opacity-30 blur-3xl"
            style={{ background: 'radial-gradient(circle, #f59e0b 0%, transparent 70%)' }}
          />

          <div className="relative space-y-6">
            {/* Emblem & Brand Wordmark */}
            <div className="flex items-center gap-3.5">
              <div className="relative h-14 w-14 shrink-0">
                <div
                  className="absolute inset-0 animate-spin rounded-full"
                  style={{
                    background:
                      'conic-gradient(from 0deg, #f59e0b 0deg, #7567ee 140deg, #f59e0b 280deg, #7567ee 360deg)',
                    animationDuration: '6s',
                  }}
                />
                <div className="absolute inset-[2px] rounded-full bg-[#0e1428]" />
                <div className="absolute inset-[4px] overflow-hidden rounded-full bg-white">
                  <img
                    src={logoUrl}
                    alt="GB STUDY"
                    referrerPolicy="no-referrer"
                    className="h-full w-full object-cover"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none';
                    }}
                  />
                </div>
              </div>
              <div>
                <h1
                  data-gb-brand="1"
                  className="font-['Cinzel',serif] text-xl font-extrabold tracking-wide text-white"
                >
                  GB STUDY
                </h1>
                <p className="text-xs font-medium text-amber-300/90">
                  Disha Online Classes Portal
                </p>
              </div>
            </div>

            <div className="space-y-2 pt-2">
              <h2 className="text-2xl font-bold leading-snug tracking-tight text-white [text-wrap:balance]">
                Your Complete Board &amp; Batch Classroom
              </h2>
              <p className="text-xs leading-relaxed text-slate-300/80">
                Sign in with your Disha Online Classes account to access live schedules, lectures, and study notes seamlessly.
              </p>
            </div>

            {/* Clean Hairline Feature List */}
            <div className="divide-y divide-white/8 border-y border-white/8 text-xs text-slate-200">
              <div className="flex items-center gap-3 py-3">
                <PlayCircle className="h-4 w-4 shrink-0 text-amber-400" />
                <span>HD Recorded &amp; Live Classrooms</span>
              </div>
              <div className="flex items-center gap-3 py-3">
                <FileText className="h-4 w-4 shrink-0 text-indigo-400" />
                <span>Board PDF Notes, DPPs &amp; Chapter Folders</span>
              </div>
              <div className="flex items-center gap-3 py-3">
                <BookOpen className="h-4 w-4 shrink-0 text-emerald-400" />
                <span>Multi-Batch Access with Smooth Playback</span>
              </div>
            </div>
          </div>

          <div className="relative flex items-center gap-2 pt-6 text-[11px] text-slate-400">
            <ShieldCheck className="h-4 w-4 shrink-0 text-amber-400/90" />
            <span>Protected direct verification with Disha API</span>
          </div>
        </div>

        {/* Right Sign-In Form Panel */}
        <div className="md:col-span-7 p-6 sm:p-8 flex flex-col justify-center">
          {/* Mobile Compact Header */}
          <div className="mb-6 flex items-center gap-3.5 md:hidden">
            <div className="relative h-12 w-12 shrink-0">
              <div
                className="absolute inset-0 animate-spin rounded-full"
                style={{
                  background:
                    'conic-gradient(from 0deg, #f59e0b 0deg, #7567ee 140deg, #f59e0b 280deg, #7567ee 360deg)',
                  animationDuration: '6s',
                }}
              />
              <div className="absolute inset-[2px] rounded-full bg-[#0d1220]" />
              <div className="absolute inset-[4px] overflow-hidden rounded-full bg-white">
                <img
                  src={logoUrl}
                  alt="GB STUDY"
                  referrerPolicy="no-referrer"
                  className="h-full w-full object-cover"
                />
              </div>
            </div>
            <div>
              <h1
                data-gb-brand="1"
                className="font-['Cinzel',serif] text-lg font-extrabold tracking-wide text-white"
              >
                GB STUDY
              </h1>
              <p className="text-xs text-slate-400">Official Disha Account Login</p>
            </div>
          </div>

          <div className="space-y-1.5">
            <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-white">
              Sign in to Disha Classes
            </h2>
            <p className="text-xs sm:text-sm text-slate-400">
              Use your registered Disha mobile number, email, or User ID &amp; token.
            </p>
          </div>

          {/* Segmented Mode Switcher */}
          <div className="mt-5 grid grid-cols-2 gap-1 rounded-xl border border-white/10 bg-white/[0.03] p-1">
            <button
              type="button"
              onClick={() => {
                setAuthMode('credentials');
                setStatusMsg(null);
              }}
              className={`rounded-lg py-2.5 px-3 text-xs font-semibold transition-all whitespace-nowrap cursor-pointer ${
                authMode === 'credentials'
                  ? 'bg-[#5a4bda] text-white shadow-[0_4px_14px_rgba(90,75,218,0.45)]'
                  : 'text-slate-400 hover:text-white hover:bg-white/[0.04]'
              }`}
            >
              Mobile Login
            </button>
            <button
              type="button"
              onClick={() => {
                setAuthMode('token');
                setStatusMsg(null);
              }}
              className={`rounded-lg py-2.5 px-3 text-xs font-semibold transition-all whitespace-nowrap cursor-pointer ${
                authMode === 'token'
                  ? 'bg-[#5a4bda] text-white shadow-[0_4px_14px_rgba(90,75,218,0.45)]'
                  : 'text-slate-400 hover:text-white hover:bg-white/[0.04]'
              }`}
            >
              User ID &amp; Token
            </button>
          </div>

          {statusMsg && (
            <div
              className={`mt-4 flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-xs ${
                statusMsg.type === 'ok'
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                  : 'border-red-500/30 bg-red-500/10 text-red-300'
              }`}
            >
              {statusMsg.type === 'ok' ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              ) : (
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              )}
              <span className="leading-relaxed">{statusMsg.text}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="mt-5 space-y-4">
            {authMode === 'credentials' ? (
              <>
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-slate-300">
                    Mobile Number or Email
                  </label>
                  <div className="relative">
                    <Phone className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      required
                      value={phoneInput}
                      onChange={(e) => setPhoneInput(e.target.value)}
                      placeholder="Enter registered mobile or email"
                      className="w-full rounded-xl border border-white/12 bg-white/[0.04] py-3 pr-4 pl-10 text-sm text-white outline-none placeholder:text-slate-500 transition-colors focus:border-amber-400/70 focus:bg-white/[0.06] focus:ring-2 focus:ring-amber-400/15"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-slate-300">
                    Password
                  </label>
                  <div className="relative">
                    <Lock className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      required
                      value={passwordInput}
                      onChange={(e) => setPasswordInput(e.target.value)}
                      placeholder="Enter your Disha password"
                      className="w-full rounded-xl border border-white/12 bg-white/[0.04] py-3 pr-11 pl-10 text-sm text-white outline-none placeholder:text-slate-500 transition-colors focus:border-amber-400/70 focus:bg-white/[0.06] focus:ring-2 focus:ring-amber-400/15"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((prev) => !prev)}
                      className="absolute top-1/2 right-3 -translate-y-1/2 rounded-md p-1 text-slate-400 hover:text-white cursor-pointer"
                      aria-label="Toggle password visibility"
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-slate-300">
                    Disha User ID
                  </label>
                  <div className="relative">
                    <UserCheck className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      required
                      value={userIdInput}
                      onChange={(e) => setUserIdInput(e.target.value)}
                      placeholder="e.g. 915240"
                      className="w-full rounded-xl border border-white/12 bg-white/[0.04] py-3 pr-4 pl-10 text-sm text-white outline-none placeholder:text-slate-500 transition-colors focus:border-amber-400/70 focus:bg-white/[0.06] focus:ring-2 focus:ring-amber-400/15"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-slate-300">
                    JWT Token
                  </label>
                  <div className="relative">
                    <KeyRound className="pointer-events-none absolute top-3.5 left-3.5 h-4 w-4 text-slate-400" />
                    <textarea
                      rows={3}
                      required
                      value={tokenInput}
                      onChange={(e) => setTokenInput(e.target.value)}
                      placeholder="Paste your Disha JWT Token..."
                      className="w-full rounded-xl border border-white/12 bg-white/[0.04] py-2.5 pr-4 pl-10 text-xs font-mono text-white outline-none placeholder:font-sans placeholder:text-slate-500 transition-colors focus:border-amber-400/70 focus:bg-white/[0.06] focus:ring-2 focus:ring-amber-400/15"
                    />
                  </div>
                </div>
              </>
            )}

            <button
              type="submit"
              disabled={loading}
              className="mt-1 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#5a4bda] via-[#6c5ce7] to-[#4e3fd3] px-5 py-3.5 text-sm font-bold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_12px_28px_-8px_rgba(90,75,218,0.65)] transition-all hover:brightness-110 active:scale-[0.99] disabled:opacity-60 cursor-pointer"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <span>Continue to GB STUDY</span>
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>
          </form>

          <p className="mt-5 text-center text-[11px] text-slate-500">
            Your credentials stay private to your browser session on{' '}
            <span data-gb-brand="1" className="font-semibold text-slate-300">
              GB STUDY
            </span>
            .
          </p>
        </div>
      </div>
    </div>
  );
};
