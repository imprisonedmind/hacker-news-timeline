import { useEffect, useRef, useState } from "react";

export function useInView(rootMargin = "200px 0px") {
  const ref = useRef<HTMLDivElement | null>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const target = ref.current;
    if (!target || inView) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setInView(true);
          observer.disconnect();
        }
      },
      { rootMargin },
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, [inView, rootMargin]);

  return { ref, inView };
}
