"use client";

import { useRouter } from "next/navigation";
import type { ComponentPropsWithoutRef } from "react";

type Props = ComponentPropsWithoutRef<"a"> & {
  href: string;
  replace?: boolean;
  scroll?: boolean;
};

/**
 * Vinext's bundled Link currently fails during prefetch/navigation setup.
 * Keep native anchor behavior and use the working router API for same-tab
 * navigation so the shared GPS lookup survives page transitions.
 */
export default function SiteLink({ href, replace, scroll, onClick, ...props }: Props) {
  const router = useRouter();
  return <a {...props} href={href} onClick={(event) => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey ||
      event.shiftKey || event.altKey || (props.target && props.target !== "_self") ||
      props.download !== undefined) return;
    const destination = new URL(href, window.location.href);
    if (destination.origin !== window.location.origin) return;
    event.preventDefault();
    const path = destination.pathname + destination.search + destination.hash;
    if (replace) router.replace(path, { scroll });
    else router.push(path, { scroll });
  }} />;
}
