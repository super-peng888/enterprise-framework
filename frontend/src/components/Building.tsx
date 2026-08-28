import { Construction } from 'lucide-react'
import './Building.css'

interface BuildingProps {
  title?: string
}

/** 统一「模块建设中」占位页 */
export default function Building({ title = '模块建设中' }: BuildingProps) {
  return (
    <div className="core-card building-page">
      <div className="building-icon">
        <Construction size={28} strokeWidth={1.8} />
      </div>
      <h3 className="building-title">{title}</h3>
      <p className="building-desc">该模块正在加紧建设中，敬请期待。</p>
    </div>
  )
}
