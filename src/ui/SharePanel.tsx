import { useState } from 'react'
import { PeopleMenu } from 'tldraw'

export function SharePanel() {
	const [copied, setCopied] = useState(false)
	return (
		<div className="tlui-share-zone share" draggable={false}>
			<PeopleMenu />
			<button
				className="share-invite"
				title="Everyone with this link edits the same canvas"
				onClick={async () => {
					await navigator.clipboard.writeText(location.href)
					setCopied(true)
					setTimeout(() => setCopied(false), 1600)
				}}
			>
				{copied ? 'Link copied' : 'Invite'}
			</button>
		</div>
	)
}
