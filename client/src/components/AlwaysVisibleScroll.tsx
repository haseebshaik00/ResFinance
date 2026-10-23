import { useEffect, useRef, useState, type ReactNode } from "react";

export function AlwaysVisibleScroll({ children }: { children: ReactNode }) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState({ top: 0, height: 48 });

  useEffect(() => {
    const body = bodyRef.current;
    if (body === null) {
      return;
    }

    const syncThumb = () => {
      const { scrollTop, scrollHeight, clientHeight } = body;
      if (scrollHeight <= clientHeight) {
        setThumb({ top: 0, height: clientHeight });
        return;
      }
      const height = Math.max((clientHeight / scrollHeight) * clientHeight, 36);
      const top =
        (scrollTop / (scrollHeight - clientHeight)) * (clientHeight - height);
      setThumb({ top, height });
    };

    syncThumb();
    body.addEventListener("scroll", syncThumb, { passive: true });
    const observer = new ResizeObserver(syncThumb);
    observer.observe(body);
    return () => {
      body.removeEventListener("scroll", syncThumb);
      observer.disconnect();
    };
  }, []);

  return (
    <div className="always-visible-scroll">
      <div className="always-visible-scroll-body" ref={bodyRef}>
        {children}
      </div>
      <div className="always-visible-scroll-track" aria-hidden="true">
        <div
          className="always-visible-scroll-thumb"
          style={{ top: `${thumb.top}px`, height: `${thumb.height}px` }}
        />
      </div>
    </div>
  );
}
