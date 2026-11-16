import { useEffect, useRef, useState } from 'react';
import { TerrainViewport, type ViewportOptions } from '../render/Viewport';
import { t } from './i18n';

export function Viewport(props: ViewportOptions) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const { gridSize, devicePixelRatioMax, devicePixelRatioMaxMobile } = props;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let viewport: TerrainViewport | null = null;
    try {
      viewport = new TerrainViewport(host, {
        gridSize,
        devicePixelRatioMax,
        devicePixelRatioMaxMobile,
      });
    } catch {
      setFailed(true);
    }
    return () => viewport?.dispose();
  }, [gridSize, devicePixelRatioMax, devicePixelRatioMaxMobile]);

  return (
    <div ref={hostRef} className="viewport">
      {failed && <p className="viewport-error">{t('error.webgl')}</p>}
    </div>
  );
}
