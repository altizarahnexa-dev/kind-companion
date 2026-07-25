import { useEffect, useRef } from "react";

/** Attach to a sentinel div at the end of a list to trigger `onLoadMore`. */
export function useInfiniteScroll(onLoadMore: () => void, enabled = true) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!enabled || !ref.current) return;
    const el = ref.current;
    const observer = new IntersectionObserver(
      (entries) => { if (entries[0]?.isIntersecting) onLoadMore(); },
      { rootMargin: "400px 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [onLoadMore, enabled]);
  return ref;
}
