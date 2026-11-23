import React, { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import {
  ArrowLeft,
  CheckCircle2,
  Download,
  ExternalLink,
  FileText,
  Loader2,
  Maximize,
  Minimize,
  MoreVertical,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Settings,
  Volume2,
  VolumeX,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { QualityOption, decryptXor28PdfBytes, fetchVideoDetails } from '../lib/dishaApi';
import { saveOfflineDownload } from '../lib/storage';

interface VideoPlayerViewProps {
  title: string;
  batchId?: string;
  batchName?: string;
  subjectName?: string;
  chapterId?: string;
  lectureId?: string;
  streamUrl: string;
  embedUrl: string;
  qualities: QualityOption[];
  drmLicenseUrl?: string;
  drmLicenseToken?: string;
  drmCertificateUrl?: string;
  hasPdf: boolean;
  pdfHref?: string;
  onBack: () => void;
  onOpenPdf?: () => void;
  onDownloadVideo?: (quality?: string) => void;
  downloadTask?: { status: string; progress: number; message?: string } | null;
}

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

function loadShakaPlayerScript(): Promise<any> {
  if (typeof window !== 'undefined' && (window as any).shaka) {
    return Promise.resolve((window as any).shaka);
  }
  return new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-gb-shaka="1"]') as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener('load', () => resolve((window as any).shaka));
      existing.addEventListener('error', reject);
      return;
    }
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/shaka-player/4.15.5/shaka-player.compiled.js';
    s.async = true;
    s.setAttribute('data-gb-shaka', '1');
    s.onload = () => resolve((window as any).shaka);
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

function encodeMpProxyUrl(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    if (!/(^|\.)(classx\.co\.in|cloud-front\.in|akamai\.net\.in|cloudfront\.net)$/i.test(u.hostname)) {
      return rawUrl;
    }
    const b64 = btoa(unescape(encodeURIComponent(rawUrl)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const segName = u.pathname.split('/').pop() || 'stream';
    return `${window.location.origin}/api/mp/${b64}/${encodeURIComponent(segName)}`;
  } catch {
    return rawUrl;
  }
}

export const VideoPlayerView: React.FC<VideoPlayerViewProps> = ({
  title,
  batchId,
  chapterId,
  lectureId,
  streamUrl,
  embedUrl,
  qualities,
  drmLicenseUrl,
  drmLicenseToken,
  hasPdf,
  pdfHref,
  onBack,
  onOpenPdf,
  onDownloadVideo,
  downloadTask,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const directVideoRef = useRef<HTMLVideoElement>(null);
  const appxIframeRef = useRef<HTMLIFrameElement>(null);
  const activeVideoElRef = useRef<HTMLVideoElement | null>(null);
  const hlsInstanceRef = useRef<Hls | null>(null);
  const shakaInstanceRef = useRef<any>(null);
  const dashFallbackTriggeredRef = useRef(false);

  const effectiveEmbedUrl = embedUrl;

  const isAppxPlayer = Boolean(
    effectiveEmbedUrl &&
      (effectiveEmbedUrl.includes('/api/disha-player') ||
        effectiveEmbedUrl.includes('/api/player-page-proxy') ||
        effectiveEmbedUrl.includes('appx-play.classx.co.in') ||
        effectiveEmbedUrl.includes('player.appx.co.in'))
  );

  const [selectedUrl, setSelectedUrl] = useState<string>(streamUrl || qualities?.[0]?.url || '');
  const [selectedQualityLabel, setSelectedQualityLabel] = useState<string>('720p');

  useEffect(() => {
    dashFallbackTriggeredRef.current = false;
    const nextUrl = streamUrl || qualities?.[0]?.url || '';
    if (nextUrl && nextUrl !== selectedUrl) {
      setSelectedUrl(nextUrl);
    }
  }, [streamUrl, qualities, lectureId]);

  const youtubeVideoId = (() => {
    const candidate = ((!isAppxPlayer && effectiveEmbedUrl) || selectedUrl || streamUrl || '').trim();
    if (!candidate) return '';
    if (/^[A-Za-z0-9_-]{11}$/.test(candidate)) return candidate;
    try {
      const parsed = new URL(candidate);
      const host = parsed.hostname.toLowerCase();
      if (
        host === 'youtu.be' ||
        host === 'youtube.com' ||
        host.endsWith('.youtube.com') ||
        host === 'youtube-nocookie.com' ||
        host.endsWith('.youtube-nocookie.com')
      ) {
        const match = candidate.match(/(?:v=|youtu\.be\/|embed\/|live\/|shorts\/)([A-Za-z0-9_-]{11})/);
        return match?.[1] || '';
      }
      return '';
    } catch {
      return '';
    }
  })();

  const youtubeEmbedSrc = youtubeVideoId
    ? `https://www.youtube.com/embed/${youtubeVideoId}?enablejsapi=1&autoplay=1&playsinline=1&rel=0`
    : '';

  const isYoutube = Boolean(youtubeEmbedSrc && !isAppxPlayer);

  const [availableHlsQualities, setAvailableHlsQualities] = useState<string[]>([
    'Auto',
    '1080p',
    '720p',
    '480p',
    '360p',
    '240p',
  ]);
  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState(1);
  const speedRef = useRef(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [videoFit, setVideoFit] = useState<'fill' | 'contain' | 'cover'>('contain');
  const videoFitRef = useRef<'fill' | 'contain' | 'cover'>('contain');
  const [controlsVisible, setControlsVisible] = useState(true);
  const [activePopup, setActivePopup] = useState<'none' | 'speed' | 'quality' | 'settings'>('none');
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [useDirectWorkerServer, setUseDirectWorkerServer] = useState(false);
  const hideTimerRef = useRef<number | null>(null);

  const resetHideTimer = () => {
    setControlsVisible(true);
    if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = window.setTimeout(() => {
      setControlsVisible(false);
      setActivePopup('none');
      setShowMoreMenu(false);
    }, 3600);
  };

  useEffect(() => {
    resetHideTimer();
    return () => {
      if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    };
  }, []);

  // Sync fullscreen state with browser fullscreen events & auto-fit edge-to-edge in fullscreen
  useEffect(() => {
    const onFsChange = () => {
      const fsActive = Boolean(
        document.fullscreenElement || (document as any).webkitFullscreenElement
      );
      setIsFullscreen(fsActive);
      const nextFit: 'fill' | 'contain' | 'cover' = fsActive ? 'fill' : 'contain';
      setVideoFit(nextFit);
      videoFitRef.current = nextFit;
    };
    document.addEventListener('fullscreenchange', onFsChange);
    document.addEventListener('webkitfullscreenchange', onFsChange);
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange);
      document.removeEventListener('webkitfullscreenchange', onFsChange);
    };
  }, []);

  const cycleVideoFit = () => {
    resetHideTimer();
    const order: ('fill' | 'contain' | 'cover')[] = ['fill', 'contain', 'cover'];
    const next = order[(order.indexOf(videoFit) + 1) % order.length];
    setVideoFit(next);
    videoFitRef.current = next;
  };

  // Build merged quality options list for every lecture
  const qualityChoices: { label: string; url?: string }[] = (() => {
    if (qualities && qualities.length > 0) {
      const list: { label: string; url?: string }[] = qualities.map((q) => ({
        label: String(q.quality || q.label || '720p'),
        url: q.url,
      }));
      if (!list.some((item) => item.label.toLowerCase() === 'auto')) {
        list.unshift({ label: 'Auto', url: streamUrl || qualities[0]?.url });
      }
      return list;
    }
    return availableHlsQualities.map((q) => ({ label: q }));
  })();

  // Attach Shaka Player (DASH .mpd + Widevine/FairPlay DRM), HLS.js (.m3u8), or direct MP4 source when using direct <video> element
  useEffect(() => {
    if (isAppxPlayer || isYoutube) return;
    const videoEl = directVideoRef.current;
    if (!videoEl || !selectedUrl) return;

    let cancelled = false;
    activeVideoElRef.current = videoEl;

    if (hlsInstanceRef.current) {
      try {
        hlsInstanceRef.current.destroy();
      } catch {
        // ignore
      }
      hlsInstanceRef.current = null;
    }

    if (shakaInstanceRef.current) {
      try {
        shakaInstanceRef.current.destroy();
      } catch {
        // ignore
      }
      shakaInstanceRef.current = null;
    }

    // If this exact lecture also has its own verified non-DRM HLS stream in qualities (e.g. liveclasses.cloud-front.in),
    // switch to that same lecture's HLS stream ONLY if DASH DRM fails on this device. Never load a different lecture!
    const trySameLectureHlsOption = () => {
      if (cancelled || dashFallbackTriggeredRef.current) return;
      dashFallbackTriggeredRef.current = true;
      const ownHls = (qualities || []).find(
        (q) => q.url && /\.m3u8(\?|$)/i.test(q.url) && q.url !== selectedUrl
      );
      if (ownHls?.url) {
        setSelectedUrl(ownHls.url);
        return;
      }
      setBuffering(false);
    };

    const isDashStream = /\.mpd(?:\?|$)/i.test(selectedUrl);
    const isHlsStream =
      !isDashStream &&
      (/\.m3u8(?:\?|$)/i.test(selectedUrl) ||
        /\/hls\?/i.test(selectedUrl) ||
        selectedUrl.includes('/api/disha/appx-hls'));

    if (isDashStream) {
      setBuffering(true);
      (async () => {
        try {
          const shaka = await loadShakaPlayerScript();
          if (cancelled || !shaka || !directVideoRef.current) return;
          shaka.polyfill.installAll();
          const player = new shaka.Player();
          await player.attach(directVideoRef.current);
          shakaInstanceRef.current = player;

          player.addEventListener('error', (evt: any) => {
            if (evt?.detail?.severity === 2) {
              trySameLectureHlsOption();
            }
          });

          const drmServers: Record<string, string> = {};
          if (drmLicenseUrl) {
            drmServers['com.widevine.alpha'] = drmLicenseUrl;
            drmServers['com.microsoft.playready'] = drmLicenseUrl;
            drmServers['com.apple.fps.1_0'] = drmLicenseUrl;
          }

          player.configure({
            drm: {
              servers: drmServers,
              advanced: {
                'com.widevine.alpha': {
                  videoRobustness: 'SW_SECURE_CRYPTO',
                  audioRobustness: 'SW_SECURE_CRYPTO',
                },
              },
            },
            streaming: {
              bufferingGoal: 20,
              rebufferingGoal: 2,
              retryParameters: {
                maxAttempts: 4,
                baseDelay: 500,
                backoffFactor: 1.5,
              },
            },
          });

          const rawQuery = selectedUrl.includes('?') ? selectedUrl.split('?')[1] : '';
          const edgeTokenParam =
            rawQuery
              .split('&')
              .find((p) => p.toLowerCase().startsWith('edge-cache-token=')) || '';

          const netEngine = player.getNetworkingEngine();
          if (netEngine) {
            netEngine.registerRequestFilter((type: any, request: any) => {
              if (type === shaka.net.NetworkingEngine.RequestType.LICENSE) {
                if (drmLicenseToken) {
                  request.headers['pallycon-customdata-v2'] = drmLicenseToken;
                }
                request.headers['Content-Type'] = 'application/octet-stream';
                return;
              }

              if (Array.isArray(request.uris)) {
                request.uris = request.uris.map((u: string) => {
                  let targetUri = u;
                  if (
                    edgeTokenParam &&
                    !targetUri.includes('edge-cache-token') &&
                    !targetUri.startsWith(window.location.origin)
                  ) {
                    targetUri += (targetUri.includes('?') ? '&' : '?') + edgeTokenParam;
                  }
                  if (!targetUri.startsWith(window.location.origin)) {
                    targetUri = encodeMpProxyUrl(targetUri);
                  }
                  return targetUri;
                });
              }
            });
          }

          await player.load(encodeMpProxyUrl(selectedUrl));
          if (cancelled) return;
          setBuffering(false);

          try {
            const tracks = player.getVariantTracks?.() || [];
            const heights: number[] = tracks
              .map((t: any) => Number(t?.height || 0))
              .filter((h: number) => h > 0);
            const uniqueHeights = Array.from(new Set(heights)).sort((a, b) => b - a);
            if (uniqueHeights.length > 0) {
              setAvailableHlsQualities(['Auto', ...uniqueHeights.map((h) => `${h}p`)]);
            }
          } catch {
            // ignore
          }

          videoEl.playbackRate = speedRef.current;
          videoEl.play().catch(() => {});
        } catch {
          trySameLectureHlsOption();
        }
      })();
    } else if (isHlsStream && Hls.isSupported()) {
      const playbackUrl = !selectedUrl.startsWith('/api/')
        ? encodeMpProxyUrl(selectedUrl)
        : selectedUrl;

      const hls = new Hls({
        enableWorker: false,
        lowLatencyMode: false,
        autoStartLoad: true,
        maxBufferLength: 18,
        maxMaxBufferLength: 45,
      });
      hlsInstanceRef.current = hls;
      hls.loadSource(playbackUrl);
      hls.attachMedia(videoEl);
      hls.on(Hls.Events.MANIFEST_PARSED, (_evt, data) => {
        setBuffering(false);
        if (data?.levels && data.levels.length > 0) {
          const heights = Array.from(
            new Set(
              data.levels
                .map((l) => l.height)
                .filter((h): h is number => Boolean(h && h > 0))
                .sort((a, b) => b - a)
                .map((h) => `${h}p`)
            )
          );
          if (heights.length > 0) {
            setAvailableHlsQualities(['Auto', ...heights]);
          }
        }
        videoEl.playbackRate = speedRef.current;
        videoEl.play().catch(() => {});
      });
      hls.on(Hls.Events.FRAG_LOADED, () => {
        setBuffering(false);
      });
      hls.on(Hls.Events.FRAG_BUFFERED, () => {
        setBuffering(false);
      });
      hls.on(Hls.Events.ERROR, (_evt, data) => {
        if (data?.fatal) {
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            hls.startLoad();
          } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
            hls.recoverMediaError();
          } else {
            setBuffering(false);
          }
        }
      });
    } else {
      videoEl.src = !selectedUrl.startsWith('/api/') ? encodeMpProxyUrl(selectedUrl) : selectedUrl;
      videoEl.load();
      videoEl.playbackRate = speedRef.current;
      videoEl.play().catch(() => {});
    }

    return () => {
      cancelled = true;
      if (hlsInstanceRef.current) {
        try {
          hlsInstanceRef.current.destroy();
        } catch {
          // ignore
        }
        hlsInstanceRef.current = null;
      }
      if (shakaInstanceRef.current) {
        try {
          shakaInstanceRef.current.destroy();
        } catch {
          // ignore
        }
        shakaInstanceRef.current = null;
      }
    };
  }, [isAppxPlayer, isYoutube, selectedUrl, drmLicenseUrl, drmLicenseToken, batchId, chapterId, lectureId]);

  // Send INIT_PLAYER postMessages to Appx iframe
  useEffect(() => {
    if (!isAppxPlayer) return;
    const sendInit = () => {
      const iframe = appxIframeRef.current;
      if (!iframe?.contentWindow) return;
      try {
        iframe.contentWindow.postMessage(
          { type: 'play', source: selectedUrl || streamUrl || '', watermark: title },
          '*'
        );
        iframe.contentWindow.postMessage(
          { event: 'INIT_PLAYER', type: 'play', source: selectedUrl || streamUrl || '', watermark: title },
          '*'
        );
      } catch {
        // ignore
      }
    };
    const timers = [300, 900, 1800, 3200, 5000].map((ms) => window.setTimeout(sendInit, ms));
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [isAppxPlayer, embedUrl, selectedUrl, streamUrl, title]);

  // Hook into the <video> and Hls levels inside same-origin /api/disha-player iframe
  useEffect(() => {
    if (!isAppxPlayer || useDirectWorkerServer) return;

    let attachedVideo: HTMLVideoElement | null = null;

    const onPlay = () => {
      setPlaying(true);
      setBuffering(false);
    };
    const onPause = () => setPlaying(false);
    const onTimeUpdate = () => {
      if (!attachedVideo) return;
      setCurrentTime(attachedVideo.currentTime || 0);
      if (Number.isFinite(attachedVideo.duration) && attachedVideo.duration > 0) {
        setDuration(attachedVideo.duration);
      }
    };
    const onWaiting = () => setBuffering(true);
    const onCanPlay = () => setBuffering(false);

    const interval = window.setInterval(() => {
      try {
        const win = appxIframeRef.current?.contentWindow as any;
        const doc = appxIframeRef.current?.contentDocument;
        if (!doc) return;

        const currentFit = videoFitRef.current;
        const desiredCss = `html,body{margin:0!important;padding:0!important;width:100vw!important;height:100vh!important;background:#000!important;overflow:hidden!important}body *{visibility:hidden!important}video{visibility:visible!important;position:fixed!important;top:0!important;left:0!important;right:0!important;bottom:0!important;width:100vw!important;height:100vh!important;max-width:100vw!important;max-height:100vh!important;object-fit:${currentFit}!important;background:#000!important;z-index:2147483647!important;transform:none!important}`;
        let styleEl = doc.getElementById('bat-hide-ui') as HTMLStyleElement | null;
        if (!styleEl) {
          styleEl = doc.createElement('style');
          styleEl.id = 'bat-hide-ui';
          styleEl.textContent = desiredCss;
          (doc.head || doc.documentElement).appendChild(styleEl);
        } else if (styleEl.textContent !== desiredCss) {
          styleEl.textContent = desiredCss;
        }

        // Detect live HLS quality levels from Appx iframe if available
        const iframeHls = win?.__gbHls || win?.hls;
        if (iframeHls && Array.isArray(iframeHls.levels) && iframeHls.levels.length > 0) {
          const rawHeights: number[] = iframeHls.levels
            .map((l: any) => Number(l?.height || 0))
            .filter((h: number) => h > 0);
          const uniqueSorted = Array.from(new Set<number>(rawHeights)).sort((a, b) => b - a);
          const heights: string[] = uniqueSorted.map((h) => `${h}p`);
          if (heights.length > 0) {
            setAvailableHlsQualities(['Auto', ...heights]);
          }
        }

        const vid = doc.querySelector('video');
        if (vid && activeVideoElRef.current !== vid) {
          activeVideoElRef.current = vid;
          attachedVideo = vid;
          vid.controls = false;
          vid.playsInline = true;
          vid.playbackRate = speedRef.current;
          vid.addEventListener('play', onPlay);
          vid.addEventListener('playing', onPlay);
          vid.addEventListener('pause', onPause);
          vid.addEventListener('timeupdate', onTimeUpdate);
          vid.addEventListener('loadedmetadata', onTimeUpdate);
          vid.addEventListener('durationchange', onTimeUpdate);
          vid.addEventListener('waiting', onWaiting);
          vid.addEventListener('canplay', onCanPlay);
          vid.play().catch(() => {});
        } else if (vid && Math.abs(vid.playbackRate - speedRef.current) > 0.01) {
          vid.playbackRate = speedRef.current;
        }
      } catch {
        // ignore cross-origin
      }
    }, 300);

    return () => {
      window.clearInterval(interval);
      if (attachedVideo) {
        attachedVideo.removeEventListener('play', onPlay);
        attachedVideo.removeEventListener('playing', onPlay);
        attachedVideo.removeEventListener('pause', onPause);
        attachedVideo.removeEventListener('timeupdate', onTimeUpdate);
        attachedVideo.removeEventListener('loadedmetadata', onTimeUpdate);
        attachedVideo.removeEventListener('durationchange', onTimeUpdate);
        attachedVideo.removeEventListener('waiting', onWaiting);
        attachedVideo.removeEventListener('canplay', onCanPlay);
      }
    };
  }, [isAppxPlayer, embedUrl, useDirectWorkerServer]);

  const toggleFullscreen = async () => {
    resetHideTimer();
    const el = containerRef.current as any;
    const vid = (activeVideoElRef.current || directVideoRef.current) as any;
    try {
      const isFsNow = Boolean(
        document.fullscreenElement || (document as any).webkitFullscreenElement
      );
      if (!isFsNow) {
        if (el?.requestFullscreen) {
          await el.requestFullscreen();
        } else if (el?.webkitRequestFullscreen) {
          el.webkitRequestFullscreen();
        } else if (vid?.webkitEnterFullscreen) {
          vid.webkitEnterFullscreen();
        }
        setIsFullscreen(true);
        setVideoFit('fill');
        videoFitRef.current = 'fill';
        try {
          await (screen.orientation as any)?.lock?.('landscape');
        } catch {
          // ignore orientation lock if unsupported
        }
      } else {
        if (document.exitFullscreen) {
          await document.exitFullscreen();
        } else if ((document as any).webkitExitFullscreen) {
          (document as any).webkitExitFullscreen();
        }
        setIsFullscreen(false);
        setVideoFit('contain');
        videoFitRef.current = 'contain';
        try {
          (screen.orientation as any)?.unlock?.();
        } catch {
          // ignore
        }
      }
    } catch {
      const nextFs = !isFullscreen;
      setIsFullscreen(nextFs);
      const nextFit = nextFs ? 'fill' : 'contain';
      setVideoFit(nextFit);
      videoFitRef.current = nextFit;
    }
  };

  const togglePlay = () => {
    resetHideTimer();
    const v = activeVideoElRef.current || directVideoRef.current;
    if (!v) return;
    if (v.paused || v.ended) {
      v.muted = false;
      v.play().catch(() => {});
    } else {
      v.pause();
    }
  };

  const skip = (sec: number) => {
    resetHideTimer();
    const v = activeVideoElRef.current || directVideoRef.current;
    if (!v) return;
    const maxDur = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : duration || 999999;
    v.currentTime = Math.max(0, Math.min(maxDur, (v.currentTime || 0) + sec));
    setCurrentTime(v.currentTime);
  };

  const changeSpeed = (s: number) => {
    resetHideTimer();
    setSpeed(s);
    speedRef.current = s;
    const v = activeVideoElRef.current || directVideoRef.current;
    if (v) {
      v.playbackRate = s;
    }
    if (isYoutube) {
      try {
        const ytIframe = containerRef.current?.querySelector(
          'iframe[data-yt-watch="1"]'
        ) as HTMLIFrameElement | null;
        ytIframe?.contentWindow?.postMessage(
          JSON.stringify({ event: 'command', func: 'setPlaybackRate', args: [s] }),
          '*'
        );
      } catch {
        // ignore
      }
    }
    setActivePopup('none');
  };

  const changeQuality = (choice: { label: string; url?: string }) => {
    resetHideTimer();
    setSelectedQualityLabel(choice.label);

    if (choice.url && !isAppxPlayer) {
      const prevTime = activeVideoElRef.current?.currentTime || currentTime || 0;
      setSelectedUrl(choice.url);
      window.setTimeout(() => {
        const v = activeVideoElRef.current || directVideoRef.current;
        if (v && prevTime > 0) {
          v.currentTime = prevTime;
          v.playbackRate = speedRef.current;
          v.play().catch(() => {});
        }
      }, 350);
    }

    if (hlsInstanceRef.current && hlsInstanceRef.current.levels?.length > 0) {
      if (choice.label.toLowerCase() === 'auto') {
        hlsInstanceRef.current.currentLevel = -1;
      } else {
        const targetHeight = parseInt(choice.label.replace(/\D+/g, ''), 10);
        if (targetHeight > 0) {
          let bestIdx = 0;
          let bestDiff = 99999;
          hlsInstanceRef.current.levels.forEach((lvl, idx) => {
            const diff = Math.abs((lvl.height || 0) - targetHeight);
            if (diff < bestDiff) {
              bestDiff = diff;
              bestIdx = idx;
            }
          });
          hlsInstanceRef.current.currentLevel = bestIdx;
        }
      }
    }

    if (shakaInstanceRef.current) {
      try {
        const player = shakaInstanceRef.current;
        if (choice.label.toLowerCase() === 'auto') {
          player.configure({ abr: { enabled: true } });
        } else {
          const targetHeight = parseInt(choice.label.replace(/\D+/g, ''), 10);
          const tracks = player.getVariantTracks?.() || [];
          if (targetHeight > 0 && tracks.length > 0) {
            player.configure({ abr: { enabled: false } });
            let bestTrack = tracks[0];
            let bestDiff = 99999;
            for (const t of tracks) {
              const diff = Math.abs(Number(t?.height || 0) - targetHeight);
              if (diff < bestDiff) {
                bestDiff = diff;
                bestTrack = t;
              }
            }
            if (bestTrack) {
              player.selectVariantTrack(bestTrack, true);
            }
          }
        }
      } catch {
        // ignore
      }
    }

    if (isAppxPlayer) {
      try {
        const win = appxIframeRef.current?.contentWindow as any;
        if (win?.__gbSetQuality) {
          win.__gbSetQuality(choice.label);
        }
      } catch {
        // ignore
      }
    }

    setActivePopup('none');
  };

  const formatTime = (sec: number) => {
    if (!Number.isFinite(sec) || sec < 0) return '0:00';
    const hrs = Math.floor(sec / 3600);
    const mins = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    if (hrs > 0) {
      return `${hrs}:${String(mins).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
    return `${mins}:${String(s).padStart(2, '0')}`;
  };

  const appxIframeSrc = (() => {
    if (!isAppxPlayer) return '';
    if (useDirectWorkerServer && effectiveEmbedUrl.startsWith('/api/disha-player')) {
      return effectiveEmbedUrl.replace('/api/disha-player', '/api/player-page-proxy');
    }
    return effectiveEmbedUrl;
  })();

  const showBars = controlsVisible || !playing || activePopup !== 'none' || showMoreMenu;

  const fitLabel =
    videoFit === 'fill' ? 'Full Fit' : videoFit === 'cover' ? 'Zoom' : '16:9';

  return (
    <div
      ref={containerRef}
      onMouseMove={resetHideTimer}
      onClick={() => {
        setActivePopup('none');
        setShowMoreMenu(false);
        resetHideTimer();
      }}
      className="fixed inset-0 z-50 w-screen h-dvh bg-black text-white select-none overflow-hidden"
    >
      {/* 1. FULL-BLEED 100vw x 100dvh VIDEO CANVAS (Never squished by top or bottom bars!) */}
      <div
        onClick={(e) => {
          e.stopPropagation();
          if (activePopup !== 'none' || showMoreMenu) {
            setActivePopup('none');
            setShowMoreMenu(false);
            return;
          }
          setControlsVisible((v) => !v);
        }}
        className="absolute inset-0 w-full h-full bg-black flex items-center justify-center overflow-hidden z-10"
      >
        {/* Buffering Spinner */}
        {buffering && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/40 pointer-events-none">
            <div className="w-11 h-11 rounded-full border-4 border-white/20 border-t-white/80 animate-spin" />
          </div>
        )}

        {/* 1. Appx Encrypted Stream Player */}
        {isAppxPlayer ? (
          <iframe
            ref={appxIframeRef}
            src={appxIframeSrc}
            title={title}
            data-appx-watch="1"
            className={`w-full h-full border-0 bg-black ${
              useDirectWorkerServer ? '' : 'pointer-events-none'
            }`}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
            allowFullScreen
            onLoad={() => setBuffering(false)}
          />
        ) : isYoutube ? (
          /* 2. YouTube Lecture Player */
          <iframe
            src={youtubeEmbedSrc}
            title={title}
            data-yt-watch="1"
            referrerPolicy="strict-origin-when-cross-origin"
            className="w-full h-full border-0 bg-black"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen"
            allowFullScreen
            onLoad={() => setBuffering(false)}
          />
        ) : selectedUrl ? (
          /* 3. Direct MP4 / HLS Video Element */
          <video
            ref={directVideoRef}
            style={{ objectFit: videoFit }}
            className="w-full h-full bg-black"
            playsInline
            autoPlay
            controls={false}
            onPlay={() => {
              setPlaying(true);
              setBuffering(false);
            }}
            onPlaying={() => {
              setPlaying(true);
              setBuffering(false);
            }}
            onPause={() => setPlaying(false)}
            onWaiting={() => setBuffering(true)}
            onCanPlay={() => setBuffering(false)}
            onLoadedData={() => setBuffering(false)}
            onTimeUpdate={(e) => {
              setCurrentTime(e.currentTarget.currentTime);
              if (e.currentTarget.currentTime > 0 && !e.currentTarget.paused) {
                setBuffering(false);
              }
            }}
            onLoadedMetadata={(e) => {
              setDuration(e.currentTarget.duration);
              setBuffering(false);
            }}
          />
        ) : (
          <div className="flex flex-col items-center justify-center p-6 text-center">
            <div className="w-10 h-10 rounded-full border-4 border-white/20 border-t-white animate-spin mb-3" />
            <p className="text-xs text-gray-400">Loading Lecture Stream...</p>
          </div>
        )}
      </div>

      {/* 2. FLOATING TOP OVERLAY BAR (Overlays video so it NEVER steals height from the video!) */}
      <div
        onClick={(e) => e.stopPropagation()}
        className={`absolute top-0 left-0 right-0 px-4 py-2.5 flex items-center justify-between bg-gradient-to-b from-black/85 via-black/40 to-transparent z-30 transition-opacity duration-200 ${
          showBars ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (document.fullscreenElement) {
                document.exitFullscreen().catch(() => {});
              }
              onBack();
            }}
            aria-label="Back"
            className="p-2 rounded-full bg-black/40 hover:bg-white/20 text-white cursor-pointer shrink-0"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <span className="text-xs sm:text-sm font-semibold text-white drop-shadow truncate">
            {title}
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0 relative">
          {hasPdf && (onOpenPdf || pdfHref) && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (onOpenPdf) {
                  onOpenPdf();
                } else if (pdfHref) {
                  window.open(pdfHref, '_blank', 'noopener,noreferrer');
                }
              }}
              title="Open Class PDF Notes"
              className="px-2.5 py-1.5 rounded-lg bg-[#5a4bda]/90 hover:bg-[#5a4bda] border border-white/20 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Notes</span>
            </button>
          )}

          {/* Screen Fit Mode Button (16:9 / Full Fit / Zoom) */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              cycleVideoFit();
            }}
            title="Change Screen Fit (Full / 16:9 / Zoom)"
            className="px-2.5 py-1.5 rounded-lg bg-black/50 hover:bg-white/20 border border-white/20 text-white text-xs font-bold cursor-pointer"
          >
            Screen: {fitLabel}
          </button>

          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowMoreMenu((m) => !m);
              setActivePopup('none');
            }}
            aria-label="More options"
            className="p-2 rounded-full bg-black/40 hover:bg-white/20 text-white cursor-pointer"
          >
            <MoreVertical className="w-5 h-5" />
          </button>

          {/* 3-Dots Dropdown Menu (Download to Gallery + PDF Notes + Player Mode) */}
          {showMoreMenu && (
            <div
              onClick={(e) => e.stopPropagation()}
              className="absolute right-0 top-11 w-64 rounded-2xl bg-[#18181b] border border-white/15 shadow-2xl py-2 z-50 text-xs font-semibold"
            >
              <div className="px-4 py-2 border-b border-white/10 text-gray-400 truncate">
                {title}
              </div>

              {onDownloadVideo && (
                <button
                  onClick={() => {
                    setShowMoreMenu(false);
                    onDownloadVideo(selectedQualityLabel);
                  }}
                  className="w-full px-4 py-3 text-left hover:bg-white/10 flex items-center gap-2.5 text-emerald-400 font-bold cursor-pointer"
                >
                  <Download className="w-4 h-4" />
                  <span>
                    {downloadTask && (downloadTask.status === 'preparing' || downloadTask.status === 'downloading' || downloadTask.status === 'converting')
                      ? `Downloading (${downloadTask.progress}%)...`
                      : `Download to Gallery (.mp4)`}
                  </span>
                </button>
              )}

              {hasPdf && onOpenPdf && (
                <button
                  onClick={() => {
                    setShowMoreMenu(false);
                    onOpenPdf();
                  }}
                  className="w-full px-4 py-3 text-left hover:bg-white/10 flex items-center gap-2.5 text-white cursor-pointer"
                >
                  <FileText className="w-4 h-4 text-indigo-400" />
                  <span>Open Class PDF Notes</span>
                </button>
              )}

              {hasPdf && !onOpenPdf && pdfHref && (
                <a
                  href={pdfHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setShowMoreMenu(false)}
                  className="w-full px-4 py-3 text-left hover:bg-white/10 flex items-center gap-2.5 text-white"
                >
                  <FileText className="w-4 h-4 text-indigo-400" />
                  <span>Open Class PDF Notes</span>
                </a>
              )}

              {isAppxPlayer && (
                <button
                  onClick={() => {
                    setUseDirectWorkerServer((u) => !u);
                    setShowMoreMenu(false);
                  }}
                  className="w-full px-4 py-3 text-left hover:bg-white/10 flex items-center gap-2.5 text-gray-300 cursor-pointer"
                >
                  <Settings className="w-4 h-4" />
                  <span>
                    {useDirectWorkerServer ? 'Switch to Custom Player' : 'Switch to Native Controls'}
                  </span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 3. FLOATING BOTTOM CONTROLS BAR (Overlays bottom of screen so it NEVER shrinks video & NEVER clips off-screen!) */}
      <div
        onClick={(e) => e.stopPropagation()}
        className={`absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/95 via-black/75 to-transparent pb-2.5 pt-3 z-30 transition-opacity duration-200 ${
          showBars ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        {/* Row 1: Time Display + Current Speed/Quality Status */}
        <div className="px-4 pb-1 flex items-center justify-between text-xs font-bold text-white tabular-nums drop-shadow">
          <span>
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>
          <span className="text-[11px] text-gray-300 font-semibold">
            {speed}x • {selectedQualityLabel} • {fitLabel}
          </span>
        </div>

        {/* Full-width Thin Seek Line */}
        <div className="px-4 pb-1.5">
          <div className="relative h-2 w-full rounded-full bg-white/25">
            <div
              className="pointer-events-none absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-rose-500 via-red-500 to-orange-400"
              style={{
                width: `${duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0}%`,
              }}
            />
            <input
              type="range"
              min={0}
              max={duration > 0 ? duration : 100}
              step={0.5}
              value={currentTime}
              onChange={(e) => {
                resetHideTimer();
                const val = Number(e.target.value);
                setCurrentTime(val);
                const v = activeVideoElRef.current || directVideoRef.current;
                if (v) v.currentTime = val;
              }}
              className="nt-player-progress relative z-10 h-2 w-full cursor-pointer"
            />
          </div>
        </div>

        {/* Row 2: [Play/Pause, -10s, +10s, Volume] ... [Speed, Quality, Fit, Settings, Fullscreen] */}
        <div className="px-4 pt-0.5 flex flex-wrap items-center justify-between gap-2">
          {/* Left Transport Controls */}
          <div className="flex items-center gap-3 sm:gap-5">
            <button
              onClick={togglePlay}
              aria-label={playing ? 'Pause' : 'Play'}
              className="p-1.5 rounded-lg hover:bg-white/10 text-white cursor-pointer"
            >
              {playing ? (
                <Pause className="w-5 h-5 sm:w-6 sm:h-6 fill-white" />
              ) : (
                <Play className="w-5 h-5 sm:w-6 sm:h-6 fill-white" />
              )}
            </button>

            <button
              onClick={() => skip(-10)}
              aria-label="Rewind 10 seconds"
              className="relative p-1.5 rounded-lg hover:bg-white/10 flex items-center justify-center text-white cursor-pointer"
            >
              <RotateCcw className="w-5 h-5 sm:w-6 sm:h-6 stroke-[1.8]" />
              <span className="absolute text-[8px] font-extrabold mt-0.5">10</span>
            </button>

            <button
              onClick={() => skip(10)}
              aria-label="Forward 10 seconds"
              className="relative p-1.5 rounded-lg hover:bg-white/10 flex items-center justify-center text-white cursor-pointer"
            >
              <RotateCw className="w-5 h-5 sm:w-6 sm:h-6 stroke-[1.8]" />
              <span className="absolute text-[8px] font-extrabold mt-0.5">10</span>
            </button>

            <button
              onClick={() => {
                resetHideTimer();
                const next = !muted;
                setMuted(next);
                const v = activeVideoElRef.current || directVideoRef.current;
                if (v) v.muted = next;
              }}
              aria-label={muted ? 'Unmute' : 'Mute'}
              className="p-1.5 rounded-lg hover:bg-white/10 text-white cursor-pointer"
            >
              {muted ? (
                <VolumeX className="w-5 h-5 sm:w-6 sm:h-6" />
              ) : (
                <Volume2 className="w-5 h-5 sm:w-6 sm:h-6" />
              )}
            </button>
          </div>

          {/* Right Dedicated Buttons: Speed + Quality + Fit + Settings + Fullscreen */}
          <div className="flex items-center gap-1.5 sm:gap-2.5 relative">
            {/* Popup 1: Speed Menu */}
            {activePopup === 'speed' && (
              <div className="nt-player-menu absolute bottom-11 right-0 w-56 rounded-2xl bg-[#18181b] border border-white/20 p-3.5 shadow-2xl space-y-2.5 z-50">
                <div className="flex items-center justify-between border-b border-white/10 pb-2">
                  <span className="text-xs font-bold text-white">Playback Speed</span>
                  <button
                    onClick={() => setActivePopup('none')}
                    className="text-gray-400 hover:text-white cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="grid grid-cols-4 gap-1.5">
                  {SPEEDS.map((s) => (
                    <button
                      key={s}
                      onClick={() => changeSpeed(s)}
                      className={`py-1.5 rounded-lg text-xs font-bold cursor-pointer ${
                        speed === s
                          ? 'bg-[#5a4bda] text-white'
                          : 'bg-white/10 text-gray-200 hover:bg-white/20'
                      }`}
                    >
                      {s}x
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Popup 2: Video Quality Menu */}
            {activePopup === 'quality' && (
              <div className="nt-player-menu absolute bottom-11 right-0 w-52 rounded-2xl bg-[#18181b] border border-white/20 p-3.5 shadow-2xl space-y-2 z-50">
                <div className="flex items-center justify-between border-b border-white/10 pb-2">
                  <span className="text-xs font-bold text-white">Video Quality</span>
                  <button
                    onClick={() => setActivePopup('none')}
                    className="text-gray-400 hover:text-white cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="space-y-1">
                  {qualityChoices.map((q, idx) => {
                    const isSelected = selectedQualityLabel.toLowerCase() === q.label.toLowerCase();
                    return (
                      <button
                        key={idx}
                        onClick={() => changeQuality(q)}
                        className={`w-full px-3 py-2 rounded-lg text-left text-xs font-bold flex items-center justify-between cursor-pointer ${
                          isSelected
                            ? 'bg-[#5a4bda] text-white'
                            : 'bg-white/10 text-gray-200 hover:bg-white/20'
                        }`}
                      >
                        <span>{q.label}</span>
                        {isSelected && <CheckCircle2 className="w-3.5 h-3.5 text-white" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Popup 3: Combined Settings Menu (Speed + Quality + Screen Fit + Download) */}
            {activePopup === 'settings' && (
              <div className="nt-player-menu absolute bottom-11 right-0 w-64 rounded-2xl bg-[#18181b] border border-white/20 p-3.5 shadow-2xl space-y-3 z-50">
                <div className="flex items-center justify-between border-b border-white/10 pb-2">
                  <span className="text-xs font-bold text-white">Player Settings</span>
                  <button
                    onClick={() => setActivePopup('none')}
                    className="text-gray-400 hover:text-white cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div>
                  <div className="text-[11px] font-bold text-gray-300 mb-1.5">Speed ({speed}x)</div>
                  <div className="grid grid-cols-4 gap-1.5">
                    {SPEEDS.map((s) => (
                      <button
                        key={s}
                        onClick={() => changeSpeed(s)}
                        className={`py-1.5 rounded-lg text-xs font-bold cursor-pointer ${
                          speed === s
                            ? 'bg-[#5a4bda] text-white'
                            : 'bg-white/10 text-gray-200 hover:bg-white/20'
                        }`}
                      >
                        {s}x
                      </button>
                    ))}
                  </div>
                </div>

                <div className="pt-2 border-t border-white/10">
                  <div className="text-[11px] font-bold text-gray-300 mb-1.5">
                    Video Quality ({selectedQualityLabel})
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {qualityChoices.map((q, idx) => {
                      const isSelected =
                        selectedQualityLabel.toLowerCase() === q.label.toLowerCase();
                      return (
                        <button
                          key={idx}
                          onClick={() => changeQuality(q)}
                          className={`py-1.5 px-2 rounded-lg text-xs font-bold cursor-pointer ${
                            isSelected
                              ? 'bg-[#5a4bda] text-white'
                              : 'bg-white/10 text-gray-200 hover:bg-white/20'
                          }`}
                        >
                          {q.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {onDownloadVideo && (
                  <button
                    onClick={() => {
                      setActivePopup('none');
                      onDownloadVideo(selectedQualityLabel);
                    }}
                    className="w-full py-2 rounded-lg bg-[#48c774] hover:bg-[#3ec46d] text-white text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>
                      {downloadTask && (downloadTask.status === 'preparing' || downloadTask.status === 'downloading' || downloadTask.status === 'converting')
                        ? `Downloading ${downloadTask.progress}%...`
                        : `Download (${selectedQualityLabel} MP4)`}
                    </span>
                  </button>
                )}
              </div>
            )}

            {/* 1. Dedicated Visible SPEED Button */}
            <button
              onClick={() => {
                resetHideTimer();
                setActivePopup((p) => (p === 'speed' ? 'none' : 'speed'));
                setShowMoreMenu(false);
              }}
              className="px-2.5 py-1.5 rounded-lg bg-white/15 hover:bg-white/25 border border-white/15 text-white text-xs font-bold cursor-pointer transition-colors"
              title="Change Playback Speed"
            >
              {speed}x Speed
            </button>

            {/* 2. Dedicated Visible QUALITY Button */}
            <button
              onClick={() => {
                resetHideTimer();
                setActivePopup((p) => (p === 'quality' ? 'none' : 'quality'));
                setShowMoreMenu(false);
              }}
              className="px-2.5 py-1.5 rounded-lg bg-white/15 hover:bg-white/25 border border-white/15 text-white text-xs font-bold cursor-pointer transition-colors"
              title="Change Video Quality"
            >
              {selectedQualityLabel}
            </button>

            {/* 3. Dedicated Settings Gear Button */}
            <button
              onClick={() => {
                resetHideTimer();
                setActivePopup((p) => (p === 'settings' ? 'none' : 'settings'));
                setShowMoreMenu(false);
              }}
              aria-label="Settings"
              title="Speed & Quality Settings"
              className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white cursor-pointer"
            >
              <Settings className="w-5 h-5" />
            </button>

            {/* 4. Dedicated Visible FULLSCREEN Button */}
            <button
              onClick={toggleFullscreen}
              aria-label="Fullscreen"
              title="Fullscreen"
              className="px-2.5 py-1.5 rounded-lg bg-[#5a4bda] hover:bg-[#4c3ec7] text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-colors"
            >
              {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
              <span className="hidden sm:inline">{isFullscreen ? 'Exit' : 'Fullscreen'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

interface PdfViewerModalProps {
  title: string;
  pdfUrl: string;
  rawPdfUrl?: string;
  pdfKey?: string;
  batchName?: string;
  subjectName?: string;
  onBack: () => void;
}

function loadPdfJsScript(): Promise<any> {
  if (typeof window !== 'undefined' && (window as any).pdfjsLib) {
    return Promise.resolve((window as any).pdfjsLib);
  }
  return new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-gb-pdfjs="1"]') as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener('load', () => resolve((window as any).pdfjsLib));
      existing.addEventListener('error', reject);
      return;
    }
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    s.async = true;
    s.setAttribute('data-gb-pdfjs', '1');
    s.onload = () => {
      const lib = (window as any).pdfjsLib;
      if (lib?.GlobalWorkerOptions) {
        lib.GlobalWorkerOptions.workerSrc =
          'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      }
      resolve(lib);
    };
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

const PdfPageCanvas: React.FC<{ pdfDoc: any; pageNumber: number; zoom: number }> = ({
  pdfDoc,
  pageNumber,
  zoom,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [rendered, setRendered] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let renderTask: any = null;

    async function renderPage() {
      if (!pdfDoc || !canvasRef.current) return;
      try {
        const page = await pdfDoc.getPage(pageNumber);
        if (cancelled || !canvasRef.current) return;
        const baseScale = Math.min(window.innerWidth > 768 ? 1.5 : 1.15, 2.0) * (zoom / 100);
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const viewport = page.getViewport({ scale: baseScale });
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        renderTask = page.render({ canvasContext: ctx, viewport });
        await renderTask.promise;
        if (!cancelled) setRendered(true);
      } catch {
        // ignore cancelled render
      }
    }

    renderPage();
    return () => {
      cancelled = true;
      if (renderTask?.cancel) {
        try {
          renderTask.cancel();
        } catch {
          // ignore
        }
      }
    };
  }, [pdfDoc, pageNumber, zoom]);

  return (
    <div className="relative bg-white shadow-md rounded-lg overflow-hidden border border-gray-200 dark:border-slate-800 my-2 max-w-full flex flex-col items-center">
      {!rendered && (
        <div className="py-16 px-24 flex items-center justify-center text-xs text-gray-400">
          <Loader2 className="w-5 h-5 animate-spin mr-2 text-[#5a4bda]" />
          <span>Rendering Page {pageNumber}...</span>
        </div>
      )}
      <canvas ref={canvasRef} className="block max-w-full h-auto" />
      <div className="w-full py-1 px-3 bg-gray-50 dark:bg-slate-900 border-t border-gray-100 dark:border-slate-800 flex items-center justify-between text-[10px] font-semibold text-gray-500">
        <span>Page {pageNumber}</span>
        <span>GB STUDY</span>
      </div>
    </div>
  );
};

export const PdfViewerView: React.FC<PdfViewerModalProps> = ({
  title,
  pdfUrl,
  pdfKey,
  batchName,
  subjectName,
  onBack,
}) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [blobUrl, setBlobUrl] = useState<string>('');
  const [pdfBlob, setPdfBlob] = useState<Blob | null>(null);
  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const [numPages, setNumPages] = useState<number>(0);
  const [zoom, setZoom] = useState(100);
  const [savedOffline, setSavedOffline] = useState(false);

  useEffect(() => {
    let active = true;
    let createdUrl = '';

    async function loadPdf() {
      setLoading(true);
      setError(null);
      setPdfDoc(null);
      setNumPages(0);
      try {
        const res = await fetch(pdfUrl);
        if (!res.ok) {
          throw new Error(`Failed to fetch PDF (${res.status})`);
        }
        const buf = await res.arrayBuffer();
        let bytes: Uint8Array = new Uint8Array(buf);
        if (pdfKey) {
          bytes = decryptXor28PdfBytes(bytes, pdfKey);
        }
        const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'application/pdf' });
        createdUrl = URL.createObjectURL(blob);
        if (!active) return;

        setPdfBlob(blob);
        setBlobUrl(createdUrl);

        try {
          const pdfjsLib = await loadPdfJsScript();
          if (pdfjsLib && active) {
            const loadingTask = pdfjsLib.getDocument({ data: bytes.slice(0) });
            const doc = await loadingTask.promise;
            if (active && doc) {
              setPdfDoc(doc);
              setNumPages(doc.numPages || 0);
            }
          }
        } catch {
          // Fallback to iframe if pdf.js fails
        }

        if (active) {
          setLoading(false);
        }
      } catch (err: any) {
        if (active) {
          setError(err?.message || 'Unable to load PDF file');
          setLoading(false);
        }
      }
    }

    loadPdf();
    return () => {
      active = false;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [pdfUrl, pdfKey]);

  const handleDownloadDevice = () => {
    const target = blobUrl || pdfUrl;
    const a = document.createElement('a');
    a.href = target;
    a.download = `${(title || 'GB-STUDY-Notes').replace(/[^a-zA-Z0-9_-]+/g, '_')}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleSaveOffline = async () => {
    if (!pdfBlob) return;
    try {
      await saveOfflineDownload({
        id: `pdf_${Date.now()}_${title}`,
        type: 'pdf',
        title,
        batchName,
        subjectName,
        createdAt: Date.now(),
        size: pdfBlob.size,
        mimeType: 'application/pdf',
        blob: pdfBlob,
      });
      setSavedOffline(true);
    } catch {
      // ignore
    }
  };

  return (
    <div className="min-h-screen bg-[#f1f5f9] dark:bg-slate-950 text-gray-900 dark:text-white flex flex-col">
      {/* Sticky Top Header */}
      <header className="sticky top-0 z-40 flex items-center justify-between gap-2 px-4 py-3 bg-white dark:bg-slate-900 border-b border-gray-200 dark:border-slate-800 shadow-xs">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-sm font-semibold text-gray-700 dark:text-slate-200 cursor-pointer shrink-0"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back</span>
        </button>

        <div className="truncate text-xs sm:text-sm font-bold text-gray-900 dark:text-white max-w-[42%]">
          {title || 'GB STUDY PDF Notes'}
          {numPages > 0 ? ` (${numPages} Pages)` : ''}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={() => setZoom((z) => Math.max(60, z - 20))}
            className="p-1.5 rounded-lg border border-gray-200 dark:border-slate-700 text-gray-700 dark:text-slate-200 cursor-pointer"
            title="Zoom Out"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <button
            onClick={() => setZoom((z) => Math.min(200, z + 20))}
            className="p-1.5 rounded-lg border border-gray-200 dark:border-slate-700 text-gray-700 dark:text-slate-200 cursor-pointer"
            title="Zoom In"
          >
            <ZoomIn className="w-4 h-4" />
          </button>

          {pdfBlob && (
            <button
              onClick={handleSaveOffline}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#5a4bda] text-xs font-semibold text-white cursor-pointer"
            >
              {savedOffline ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Download className="w-3.5 h-3.5" />}
              <span className="hidden md:inline">{savedOffline ? 'Saved' : 'Save'}</span>
            </button>
          )}

          <button
            onClick={handleDownloadDevice}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#48c774] text-xs font-bold text-white cursor-pointer"
            title="Download PDF to Device"
          >
            <Download className="w-3.5 h-3.5" />
            <span>PDF</span>
          </button>
        </div>
      </header>

      {/* Body */}
      <div className="flex-1 flex flex-col items-center justify-start relative overflow-auto p-2 sm:p-4">
        {loading ? (
          <div className="flex flex-col items-center justify-center p-16 text-center">
            <Loader2 className="w-8 h-8 text-[#5a4bda] animate-spin mb-2" />
            <p className="text-sm font-semibold text-red-600">Loading PDF Notes...</p>
            <p className="text-xs text-gray-400 mt-1">
              Powered by <span className="text-red-600 font-bold underline">GB STUDY</span>
            </p>
          </div>
        ) : error ? (
          <div className="max-w-md mx-auto my-12 p-6 rounded-2xl bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 text-center space-y-4">
            <p className="text-sm font-bold text-red-600">{error}</p>
            <div className="flex items-center justify-center gap-3">
              <button
                onClick={onBack}
                className="px-4 py-2 rounded-xl border border-gray-300 text-xs font-bold cursor-pointer"
              >
                Go Back
              </button>
              <a
                href={pdfUrl}
                target="_blank"
                rel="noreferrer"
                className="px-4 py-2 rounded-xl bg-[#48c774] text-xs font-bold text-white"
              >
                Direct Open PDF
              </a>
            </div>
          </div>
        ) : pdfDoc && numPages > 0 ? (
          <div className="w-full flex flex-col items-center pb-10">
            {Array.from({ length: numPages }, (_, idx) => (
              <PdfPageCanvas
                key={idx + 1}
                pdfDoc={pdfDoc}
                pageNumber={idx + 1}
                zoom={zoom}
              />
            ))}
          </div>
        ) : (
          <div
            className="w-full h-[calc(100vh-72px)] flex justify-center overflow-auto"
            style={{ transform: `scale(${zoom / 100})`, transformOrigin: 'top center' }}
          >
            <iframe
              src={`${blobUrl || pdfUrl}#toolbar=1&navpanes=0`}
              title={title}
              className="w-full h-full border-0 bg-white rounded-lg"
            />
          </div>
        )}
      </div>
    </div>
  );
};

