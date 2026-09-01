import { getCanvasConnectionPath, type CanvasConnection } from '../lib/canvasConnections'

export default function CanvasReferenceConnections({ connections, markerId = 'canvas-reference-arrow' }: { connections: CanvasConnection[]; markerId?: string }) {
  if (connections.length === 0) return null

  return (
    <svg aria-hidden="true" className="pointer-events-none absolute inset-0 z-0 h-full w-full overflow-visible" data-canvas-reference-connections>
      <defs>
        <marker id={markerId} markerHeight="8" markerUnits="userSpaceOnUse" markerWidth="8" orient="auto" refX="7" refY="4" viewBox="0 0 8 8">
          <path d="M0 0 L8 4 L0 8 Z" fill="#3f78c5" />
        </marker>
      </defs>
      {connections.map((connection) => (
        <g key={connection.id} data-canvas-reference-connection>
          <path d={getCanvasConnectionPath(connection.start, connection.end)} fill="none" stroke="#3f78c5" strokeLinecap="round" strokeOpacity="0.14" strokeWidth="6" />
          <path d={getCanvasConnectionPath(connection.start, connection.end)} fill="none" stroke="#3f78c5" strokeLinecap="round" strokeOpacity="0.72" strokeWidth="1.75" strokeDasharray="10 8" className="canvas-reference-flow" markerEnd={`url(#${markerId})`} />
        </g>
      ))}
    </svg>
  )
}
