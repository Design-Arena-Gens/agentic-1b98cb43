"use client";
import { useEffect, useMemo, useRef, useState } from "react";

const defaultText = "Your Awesome Title";

const positions = [
  { id: "top", label: "Top Center" },
  { id: "middle", label: "Middle Center" },
  { id: "bottom", label: "Bottom Center" },
];

const inAnimations = [
  { id: "none", label: "None" },
  { id: "fade", label: "Fade In" },
  { id: "slide", label: "Slide Up" },
  { id: "typewriter", label: "Typewriter" },
];

const outAnimations = [
  { id: "none", label: "None" },
  { id: "fade", label: "Fade Out" },
  { id: "slide", label: "Slide Down" },
];

const sfxOptions = [
  { id: "none", label: "None" },
  { id: "whoosh", label: "Whoosh (in)" },
  { id: "pop", label: "Pop (in)" },
  { id: "typewriter", label: "Typewriter clicks" },
];

export default function Page() {
  const [videoFile, setVideoFile] = useState(null);
  const [videoUrl, setVideoUrl] = useState("");
  const [text, setText] = useState(defaultText);
  const [fontSize, setFontSize] = useState(48);
  const [color, setColor] = useState("#ffffff");
  const [position, setPosition] = useState("middle");
  const [inAnim, setInAnim] = useState("fade");
  const [outAnim, setOutAnim] = useState("none");
  const [startTime, setStartTime] = useState(0.5);
  const [endTime, setEndTime] = useState(3);
  const [sfx, setSfx] = useState("whoosh");
  const [status, setStatus] = useState("");
  const [isExporting, setIsExporting] = useState(false);

  const videoRef = useRef(null);
  const overlayRef = useRef(null);

  useEffect(() => {
    if (!videoFile) return;
    const url = URL.createObjectURL(videoFile);
    setVideoUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [videoFile]);

  // Layout computation for overlay
  const overlayStyle = useMemo(() => {
    const base = { left: "50%", transform: "translateX(-50%)", color, fontSize: `${fontSize}px` };
    if (position === "top") return { ...base, top: "8%" };
    if (position === "bottom") return { ...base, bottom: "8%" };
    return { ...base, top: "50%", transform: "translate(-50%, -50%)" };
  }, [position, color, fontSize]);

  // For live preview CSS-driven visibility synced to currentTime
  const [currentTime, setCurrentTime] = useState(0);
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    let raf;
    const tick = () => {
      setCurrentTime(v.currentTime || 0);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [videoUrl]);

  const isVisible = currentTime >= startTime && currentTime <= endTime;

  function visibleTextAtTime(t) {
    if (inAnim !== "typewriter") return text;
    if (t < startTime) return "";
    const p = Math.min(1, (t - startTime) / Math.max(0.01, endTime - startTime));
    const chars = Math.max(1, Math.floor(text.length * p));
    return text.slice(0, chars);
  }

  function opacityAtTime(t) {
    if (!isVisible) return 0;
    const inDur = 0.5;
    const outDur = 0.5;
    let a = 1;
    if (inAnim === "fade") a = Math.min(1, Math.max(0, (t - startTime) / inDur));
    if (outAnim === "fade") a = Math.min(a, Math.min(1, Math.max(0, (endTime - t) / outDur)));
    return a;
  }

  function yOffsetAtTime(t) {
    const inDur = 0.5;
    const outDur = 0.5;
    let y = 0;
    if (inAnim === "slide") y = Math.round(24 * Math.max(0, 1 - (t - startTime) / inDur));
    if (outAnim === "slide") y = Math.round(24 * Math.max(0, 1 - (endTime - t) / outDur));
    return y;
  }

  async function exportVideo() {
    if (!videoRef.current) return;
    const videoEl = videoRef.current;
    if (!videoEl.videoWidth || !videoEl.videoHeight) {
      setStatus("Loading video metadata...");
      await new Promise((r) => setTimeout(r, 200));
    }

    const width = videoEl.videoWidth || 1280;
    const height = videoEl.videoHeight || 720;

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");

    const fps = 30;
    const stream = canvas.captureStream(fps);

    // Build audio graph combining video audio and SFX
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const dest = audioContext.createMediaStreamDestination();

    // Video audio
    const source = audioContext.createMediaElementSource(videoEl);
    source.connect(dest);
    source.connect(audioContext.destination); // for local monitoring

    // SFX
    const now = audioContext.currentTime + 0.1;
    const startAt = now + Math.max(0, startTime - (videoEl.currentTime || 0));

    const sfxNodes = createSfxNodes(audioContext, sfx, text, startAt, endTime - startTime);
    if (sfxNodes) {
      sfxNodes.connect(dest);
      sfxNodes.connect(audioContext.destination);
    }

    // Compose stream: canvas video + audio mix
    const composed = new MediaStream([
      ...stream.getVideoTracks(),
      ...dest.stream.getAudioTracks(),
    ]);

    const mimeCandidates = [
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm",
    ];
    const mime = mimeCandidates.find((m) => MediaRecorder.isTypeSupported(m)) || "video/webm";
    const recorder = new MediaRecorder(composed, { mimeType: mime, videoBitsPerSecond: 6_000_000 });
    const chunks = [];
    recorder.ondataavailable = (e) => e.data && chunks.push(e.data);

    setStatus("Rendering...");
    setIsExporting(true);

    // Prepare playback
    videoEl.muted = true; // avoid double-audio (we monitor via audioContext)
    videoEl.currentTime = 0;
    await videoEl.play();

    recorder.start();

    // Animation loop
    const startPerf = performance.now();
    let lastT = -1;

    const draw = () => {
      // Keep canvas in sync with current frame
      const t = videoEl.currentTime;
      if (t === lastT) {
        // sometimes currentTime stalls; still draw to capture frames at target fps
      }
      lastT = t;

      ctx.drawImage(videoEl, 0, 0, width, height);

      // Draw text
      if (t >= startTime && t <= endTime) {
        ctx.save();
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = colorWithOpacity(color, opacityAtTime(t));
        ctx.font = `700 ${fontSize}px system-ui, -apple-system, Segoe UI, Roboto`;

        const [cx, cy] = anchorPosition(width, height, position);
        const y = cy + yOffsetAtTime(t);
        const content = visibleTextAtTime(t);
        strokeTextForContrast(ctx, content, cx, y);
        ctx.fillText(content, cx, y);
        ctx.restore();
      }

      if (!videoEl.paused && !videoEl.ended) {
        requestAnimationFrame(draw);
      }
    };

    requestAnimationFrame(draw);

    await waitForVideoEnd(videoEl);

    recorder.stop();
    const blob = await new Promise((resolve) => {
      recorder.onstop = () => resolve(new Blob(chunks, { type: mime }));
    });

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "export.webm";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setStatus("Export complete");
    setIsExporting(false);
  }

  return (
    <div className="container">
      <div className="header">
        <div className="brand">CapCut-style Text Animator</div>
        <span className="badge">Client-side export</span>
      </div>

      <div className="grid">
        <div className="card controls">
          <div className="row">
            <label>Video</label>
            <input className="input" type="file" accept="video/*" onChange={(e) => setVideoFile(e.target.files?.[0] || null)} />
          </div>

          <div className="row">
            <label>Text</label>
            <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Enter overlay text" />
          </div>

          <div className="row">
            <label>Font size</label>
            <input className="slider" type="range" min={24} max={96} value={fontSize} onChange={(e) => setFontSize(parseInt(e.target.value))} />
            <span>{fontSize}px</span>
          </div>

          <div className="row">
            <label>Color</label>
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
          </div>

          <div className="row">
            <label>Position</label>
            <select value={position} onChange={(e) => setPosition(e.target.value)}>
              {positions.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
          </div>

          <div className="row">
            <label>In animation</label>
            <select value={inAnim} onChange={(e) => setInAnim(e.target.value)}>
              {inAnimations.map((a) => (
                <option key={a.id} value={a.id}>{a.label}</option>
              ))}
            </select>
          </div>

          <div className="row">
            <label>Out animation</label>
            <select value={outAnim} onChange={(e) => setOutAnim(e.target.value)}>
              {outAnimations.map((a) => (
                <option key={a.id} value={a.id}>{a.label}</option>
              ))}
            </select>
          </div>

          <div className="row">
            <label>Text start</label>
            <input className="slider" type="range" min={0} max={10} step={0.1} value={startTime} onChange={(e) => setStartTime(parseFloat(e.target.value))} />
            <span>{startTime.toFixed(1)}s</span>
          </div>

          <div className="row">
            <label>Text end</label>
            <input className="slider" type="range" min={0.5} max={10} step={0.1} value={endTime} onChange={(e) => setEndTime(parseFloat(e.target.value))} />
            <span>{endTime.toFixed(1)}s</span>
          </div>

          <div className="row">
            <label>Sound effect</label>
            <select value={sfx} onChange={(e) => setSfx(e.target.value)}>
              {sfxOptions.map((o) => (
                <option key={o.id} value={o.id}>{o.label}</option>
              ))}
            </select>
          </div>

          <div className="footer">
            <span className="small">{status}</span>
            <button className="primary" onClick={exportVideo} disabled={!videoUrl || isExporting}>Export</button>
          </div>
        </div>

        <div className="card">
          <div className="previewWrap">
            <video ref={videoRef} src={videoUrl} controls playsInline />
            <div ref={overlayRef} className="overlay">
              {videoUrl && (
                <div
                  className="textOverlay"
                  style={{
                    ...overlayStyle,
                    opacity: opacityAtTime(currentTime),
                    transform: `${overlayStyle.transform || ""} translateY(${yOffsetAtTime(currentTime)}px)`,
                  }}
                >
                  {visibleTextAtTime(currentTime)}
                </div>
              )}
            </div>
          </div>
          <div className="small" style={{marginTop: 8}}>Tip: load a short clip (10?20s) for faster export.</div>
        </div>
      </div>

      <div style={{marginTop:16, display:'flex', justifyContent:'space-between'}}>
        <span className="small">Animations: fade, slide, typewriter ? SFX: whoosh, pop, typewriter</span>
        <a className="link small" href="https://agentic-1b98cb43.vercel.app" target="_blank" rel="noreferrer">Production URL</a>
      </div>
    </div>
  );
}

function waitForVideoEnd(video) {
  return new Promise((resolve) => {
    const onEnded = () => {
      video.removeEventListener("ended", onEnded);
      resolve();
    };
    video.addEventListener("ended", onEnded);
    // If already ended or very short, still resolve once playback reaches end
  });
}

function anchorPosition(w, h, pos) {
  if (pos === "top") return [w / 2, h * 0.12];
  if (pos === "bottom") return [w / 2, h * 0.88];
  return [w / 2, h / 2];
}

function strokeTextForContrast(ctx, text, x, y) {
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineWidth = 8;
  ctx.strokeStyle = "rgba(0,0,0,0.6)";
  ctx.strokeText(text, x, y);
  ctx.restore();
}

function hexToRgb(hex) {
  const res = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return res ? {
    r: parseInt(res[1], 16),
    g: parseInt(res[2], 16),
    b: parseInt(res[3], 16),
  } : { r: 255, g: 255, b: 255 };
}

function colorWithOpacity(hex, a) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${a.toFixed(3)})`;
}

function createSfxNodes(ctx, type, text, startAt, duration) {
  if (type === "none") return null;
  if (type === "whoosh") return makeWhoosh(ctx, startAt, 0.6);
  if (type === "pop") return makePop(ctx, startAt, 0.08);
  if (type === "typewriter") return makeTypewriter(ctx, startAt, duration, text);
  return null;
}

function makeWhoosh(ctx, when, dur) {
  const noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    const t = i / ctx.sampleRate;
    const env = Math.exp(-3 * t);
    data[i] = (Math.random() * 2 - 1) * env;
  }
  const noise = ctx.createBufferSource();
  noise.buffer = noiseBuffer;

  const filter = ctx.createBiquadFilter();
  filter.type = "highpass";
  filter.frequency.setValueAtTime(200, when);
  filter.frequency.exponentialRampToValueAtTime(4000, when + dur);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, when);
  gain.gain.exponentialRampToValueAtTime(0.5, when + 0.05);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + dur);

  noise.connect(filter).connect(gain);
  noise.start(when);
  noise.stop(when + dur);
  return gain;
}

function makePop(ctx, when, dur) {
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(220, when);
  osc.frequency.exponentialRampToValueAtTime(880, when + dur * 0.4);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, when);
  gain.gain.exponentialRampToValueAtTime(0.8, when + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + dur);

  osc.connect(gain);
  osc.start(when);
  osc.stop(when + dur);
  return gain;
}

function makeTypewriter(ctx, startAt, dur, text) {
  const root = ctx.createGain();
  root.gain.value = 1.0;
  const count = Math.max(1, Math.min(text.length, Math.floor(dur * 20)));
  for (let i = 0; i < count; i++) {
    const t = startAt + (i / count) * dur;
    const click = ctx.createOscillator();
    click.type = "square";
    click.frequency.value = 800 + Math.random() * 400;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.6, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    click.connect(g);
    g.connect(root);
    click.start(t);
    click.stop(t + 0.05);
  }
  return root;
}
