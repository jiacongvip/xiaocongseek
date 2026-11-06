import { BrandWordmark, FishLogo } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SidebarBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'

/**
 * Render the Xiaocongseek mark with the presentation requested by its host surface.
 * @param props - Host-supplied mark presentation.
 * @returns the 小葱 mark.
 */
export function OfficialBrandMark({ size }: SidebarBrandMarkOwnerProps) {
  return <FishLogo size={size} />
}

/**
 * Render the Xiaocongseek name artwork without its independently slotted mark.
 * @returns the Xiaocongseek name wordmark.
 */
export function OfficialBrandName() {
  return <BrandWordmark includeMark={false} />
}
