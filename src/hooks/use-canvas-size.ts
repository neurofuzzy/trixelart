'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * Reliable hook for measuring a container element.
 * Ensures initial size is captured and updates on window resize.
 */
export function useCanvasSize() {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  const updateSize = useCallback(() => {
    if (containerRef.current) {
      const { width, height } = containerRef.current.getBoundingClientRect();
      setSize({ width, height });
    }
  }, []);

  useEffect(() => {
    updateSize(); // Initial measurement

    const observer = new ResizeObserver(updateSize);
    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    window.addEventListener('resize', updateSize);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateSize);
    };
  }, [updateSize]);

  return { size, containerRef };
}
