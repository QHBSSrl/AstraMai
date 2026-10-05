import {
  describeValidity,
  encodeQr,
  parseWahlapQrPayload,
  qrToRgba,
  qrToSvg,
  type QrErrorCorrectionLevel,
} from '@astramai/core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const EC_LEVELS: { value: QrErrorCorrectionLevel; label: string; hint: string }[] = [
  { value: 'L', label: 'L', hint: '约 7% 容错，码最小' },
  { value: 'M', label: 'M', hint: '约 15% 容错，通用选择' },
  { value: 'Q', label: 'Q', hint: '约 25% 容错' },
  { value: 'H', label: 'H', hint: '约 30% 容错，码最大' },
];

const SOURCE_LABELS: Record<string, string> = {
  content: '二维码内容（84 字符短码）',
  'html-url': '展示页链接 .html（带时效与文案）',
  'png-url': '图片链接 .png',
  'unknown-url': '无法识别的链接',
};

/**
 * 二维码工作台。
 *
 * 设计要点：**全部在本地完成**。内容不进 URL、不发请求、不写 localStorage——
 * 机台二维码本身就是一张登入凭据，落在任何地方都是风险。
 */
export function QrStudio() {
  const [text, setText] = useState('');
  const [ecLevel, setEcLevel] = useState<QrErrorCorrectionLevel>('M');
  const [moduleSize, setModuleSize] = useState(6);
  const [now, setNow] = useState(() => new Date());
  const [copied, setCopied] = useState(false);
  const [copiedContent, setCopiedContent] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const trimmed = text.trim();
  const payload = useMemo(() => (trimmed ? parseWahlapQrPayload(trimmed) : null), [trimmed]);

  /**
   * 真正要拿去生成二维码的内容。
   *
   * 关键：机台二维码的**内容**是那串 84 字符的短码（`SGWC…`），
   * 不是几百字符的展示页 URL。拿 URL 去生成虽然也能扫出东西，
   * 但会得到一张 77×77 的码，在手表上根本看不清。
   */
  const qrContent = payload?.content ?? trimmed;

  const encoded = useMemo(() => {
    if (!qrContent) return { qr: null, error: null as string | null };
    try {
      return { qr: encodeQr(qrContent, { ecLevel }), error: null };
    } catch (error) {
      return { qr: null, error: error instanceof Error ? error.message : String(error) };
    }
  }, [qrContent, ecLevel]);

  // 有效期倒计时：只在确实是机台二维码时才需要
  useEffect(() => {
    if (!payload?.expiresAt) return;
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, [payload?.expiresAt]);

  // 画到 canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!encoded.qr) {
      canvas.width = 0;
      canvas.height = 0;
      return;
    }
    const { width, height, data } = qrToRgba(encoded.qr, moduleSize, {
      quietZone: 4,
      dark: [10, 14, 26, 255],
      light: [255, 255, 255, 255],
    });
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.putImageData(new ImageData(data, width, height), 0, 0);
  }, [encoded.qr, moduleSize]);

  const validity = payload ? describeValidity(payload, now) : null;

  const downloadPng = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !encoded.qr) return;
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `astramai-qr-v${encoded.qr!.version}-${ecLevel}.png`;
      link.click();
      URL.revokeObjectURL(url);
    }, 'image/png');
  }, [encoded.qr, ecLevel]);

  const downloadSvg = useCallback(() => {
    if (!encoded.qr) return;
    const svg = qrToSvg(encoded.qr, { moduleSize: 8, quietZone: 4, dark: '#000000' });
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `astramai-qr-v${encoded.qr.version}-${ecLevel}.svg`;
    link.click();
    URL.revokeObjectURL(url);
  }, [encoded.qr, ecLevel]);

  const pasteFromClipboard = useCallback(async () => {
    try {
      const clip = await navigator.clipboard.readText();
      if (clip) setText(clip.trim());
    } catch {
      // 浏览器可能拒绝，忽略即可
    }
  }, []);

  const copyText = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(trimmed);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }, [trimmed]);

  const copyContent = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(qrContent);
      setCopiedContent(true);
      setTimeout(() => setCopiedContent(false), 1800);
    } catch {
      setCopiedContent(false);
    }
  }, [qrContent]);

  return (
    <>
      <section className="card qr-form">
        <h3 className="card__title">二维码内容</h3>
        <textarea
          className="qr-input"
          value={text}
          spellCheck={false}
          rows={5}
          placeholder={
            '把机台二维码的链接粘贴到这里，例如\nhttps://wq.wahlap.net/qrcode/req/MAID…html?l=…&t=…&d=…\n\n也可以放任意文本 / 网址，本页会直接在本地渲染出二维码。'
          }
          onChange={(event) => setText(event.target.value)}
        />

        <div className="qr-controls">
          <button className="btn btn--ghost btn--sm" type="button" onClick={() => void pasteFromClipboard()}>
            从剪贴板粘贴
          </button>
          <button className="btn btn--ghost btn--sm" type="button" onClick={() => setText('')} disabled={!text}>
            清空
          </button>
          <button className="btn btn--ghost btn--sm" type="button" onClick={() => void copyText()} disabled={!trimmed}>
            {copied ? '已复制' : '复制内容'}
          </button>

          <div className="segmented" role="group" aria-label="纠错等级">
            {EC_LEVELS.map((level) => (
              <button
                key={level.value}
                type="button"
                title={level.hint}
                aria-pressed={ecLevel === level.value}
                onClick={() => setEcLevel(level.value)}
              >
                {level.label}
              </button>
            ))}
          </div>

          <label className="qr-slider">
            模块尺寸
            <input
              type="range"
              min={2}
              max={14}
              step={1}
              value={moduleSize}
              onChange={(event) => setModuleSize(Number(event.target.value))}
            />
            <span className="score-row__meta">{moduleSize}px</span>
          </label>
        </div>

        <p className="qr-privacy">
          内容只在你的浏览器里参与计算：不写入地址栏、不发往服务端、不存 localStorage。
          机台二维码等同于登入凭据，用完请关闭页面。
        </p>
      </section>

      {encoded.error ? (
        <div className="alert alert--error">
          <div>
            <div className="alert__title">无法生成二维码</div>
            <div className="alert__detail">{encoded.error}</div>
          </div>
        </div>
      ) : null}

      {encoded.qr ? (
        <div className="qr-layout">
          <section className="card qr-preview">
            <h3 className="card__title">预览</h3>
            <div className="qr-canvas-wrap">
              <canvas ref={canvasRef} className="qr-canvas" />
            </div>
            <div className="qr-preview__stats">
              <span className="badge badge--muted">版本 {encoded.qr.version}</span>
              <span className="badge badge--muted">{encoded.qr.size} × {encoded.qr.size}</span>
              <span className="badge badge--muted">纠错 {ecLevel}</span>
              <span className="badge badge--muted">掩码 {encoded.qr.mask}</span>
            </div>
            <div className="qr-preview__actions">
              <button className="btn btn--primary btn--sm" type="button" onClick={downloadPng}>
                下载 PNG
              </button>
              <button className="btn btn--ghost btn--sm" type="button" onClick={downloadSvg}>
                下载 SVG
              </button>
            </div>
          </section>

          {payload ? (
            <section className="card qr-analysis">
              <h3 className="card__title">载荷解析</h3>

              {payload.content ? (
                <div className="qr-content">
                  <div className="qr-content__head">
                    <span className="qr-content__label">二维码内容（喂给手表的就是这串）</span>
                    <button className="btn btn--ghost btn--sm" type="button" onClick={() => void copyContent()}>
                      {copiedContent ? '已复制' : '复制'}
                    </button>
                  </div>
                  <code className="qr-content__value">{payload.content}</code>
                  <div className="qr-content__meta">
                    共 {payload.content.length} 字符 · 版本 {encoded.qr?.version} ·{' '}
                    {encoded.qr?.size} × {encoded.qr?.size} 模块
                  </div>
                </div>
              ) : null}

              {validity ? (
                <div className={`qr-validity qr-validity--${validity.state}`}>
                  <strong>{validity.text}</strong>
                  {validity.state === 'valid' && payload.expiresAt ? (
                    <span className="score-row__meta">
                      过期时刻 {payload.expiresAt.toLocaleTimeString('zh-CN')}
                    </span>
                  ) : null}
                </div>
              ) : null}

              {payload.title ? <p className="qr-analysis__title">{payload.title}</p> : null}
              {payload.description ? <p className="qr-analysis__desc">{payload.description}</p> : null}

              <dl className="qr-facts">
                <dt>输入形态</dt>
                <dd>{SOURCE_LABELS[payload.source]}</dd>
                <dt>主机</dt>
                <dd>{payload.host ?? '—'}</dd>
                <dt>识别为</dt>
                <dd>
                  {payload.recognized
                    ? `华立机台二维码（${payload.machinePrefix ?? '未知'}）`
                    : '未识别的二维码，将按普通文本出码'}
                </dd>
                <dt>生成时间</dt>
                <dd>{payload.generatedAt ? payload.generatedAt.toLocaleString('zh-CN') : '—'}</dd>
                <dt>过期时间</dt>
                <dd>{payload.expiresAt ? payload.expiresAt.toLocaleString('zh-CN') : '—（该形态不带时效字段）'}</dd>
                <dt>有效时长</dt>
                <dd>{payload.validForMs !== null ? `${Math.round(payload.validForMs / 60000)} 分钟` : '—'}</dd>
                <dt>令牌摘要</dt>
                <dd className="score-row__meta">{payload.tokenPreview ?? '—'}</dd>
              </dl>

              <p className="qr-analysis__note">
                只有 <code>.html</code> 形态（带 <code>l</code> 参数）才有时效信息；
                <code>.png</code> 与裸内容只能解析出生成时刻。
                令牌只显示截断摘要，本页不会把它写进任何持久化位置。
              </p>
            </section>
          ) : null}
        </div>
      ) : (
        <div className="empty">
          <h2>粘贴二维码内容，本地出码</h2>
          <p>
            在微信小程序里生成机台二维码后复制链接，粘贴到上面即可。
            渲染完全在本地完成——手表端将来用的是同一份 <code>@astramai/core</code> 代码。
          </p>
        </div>
      )}
    </>
  );
}
