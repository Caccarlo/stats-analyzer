import { useEffect, useState } from 'react';

interface ViewportState {
  width: number;
  height: number;
}

function getViewportState(): ViewportState {
  if (typeof window === 'undefined') {
    return { width: 1440, height: 900 };
  }

  return {
    width: window.innerWidth,
    height: window.innerHeight,
  };
}

export function useViewport() {
  const [viewport, setViewport] = useState<ViewportState>(() => getViewportState());

  useEffect(() => {
    const handleResize = () => {
      setViewport(getViewportState());
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return viewport;
}
