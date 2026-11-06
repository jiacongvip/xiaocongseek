import type { IconProps } from './icons/props.ts'
import { XIAOCONG_LOGO_SRC } from './FishLogo.tsx'

/** Display options for the Xiaocongseek brand wordmark. */
export interface BrandWordmarkProps extends IconProps {
  /** Whether to include the leading 小葱 mark; defaults to true. */
  includeMark?: boolean | undefined
}

/**
 * Render the Xiaocongseek brand wordmark (replaces DeepSeek whale + lettering).
 * @param props.size - height in px (default 24).
 * @param props.className - extra class for layout placement.
 * @param props.includeMark - whether to include the leading 小葱 mark.
 * @returns the wordmark (aria-hidden decorative brand art).
 */
export function BrandWordmark({ size = 24, className, includeMark = true }: BrandWordmarkProps) {
  return (
    <span
      className={className}
      aria-hidden="true"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: Math.max(6, Math.round(size * 0.35)),
        height: size,
        fontSize: Math.round(size * 0.72),
        fontWeight: 700,
        letterSpacing: '-0.02em',
        lineHeight: 1,
        whiteSpace: 'nowrap',
        color: 'currentColor',
      }}
    >
      {includeMark ? (
        <img
          src={XIAOCONG_LOGO_SRC}
          alt=""
          width={size}
          height={size}
          draggable={false}
          style={{ width: size, height: size, objectFit: 'contain', objectPosition: 'center bottom', display: 'block', flexShrink: 0 }}
        />
      ) : null}
      <span>Xiaocongseek</span>
    </span>
  )
}
