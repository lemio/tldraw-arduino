import { getDownloadURL, ref, uploadBytes } from 'firebase/storage'
import { AssetRecordType, Editor, TLAsset, TLAssetStore, TLShapeId, getHashForString, uniqueId } from 'tldraw'
import { storage } from './firebase'
import { CLIP_TYPE, ClipShape } from './shapes/types'

/*
 * Images and videos dropped or pasted onto the canvas go to Firebase Cloud
 * Storage; the shared canvas keeps only their address, so everyone in the
 * room sees them. (tldraw's demo server, which does the syncing, doesn't take
 * uploads.)
 */
export const assetStore: TLAssetStore = {
	async upload(_asset: TLAsset, file: File) {
		if (!storage) throw new Error('Image and video uploads are not set up on this site (no Firebase config)')
		const name = `${uniqueId()}-${file.name}`.replace(/[^\w.-]/g, '-')
		const stored = await uploadBytes(ref(storage, `assets/${name}`), file, { contentType: file.type })
		return { src: await getDownloadURL(stored.ref) }
	},
	resolve(asset) {
		return asset.props.src
	},
}

/** Pasted links become bookmark cards, with the title and image the demo server finds for them. */
export function registerBookmarks(editor: Editor, host: string) {
	editor.registerExternalAssetHandler('url', async ({ url }) => {
		let meta: { title?: string; description?: string; image?: string; favicon?: string } | null = null
		try {
			const unfurl = new URL(`${host}/bookmarks/unfurl`)
			unfurl.searchParams.set('url', url)
			meta = await (await fetch(unfurl, { method: 'POST' })).json()
		} catch (error) {
			console.error(error)
		}
		return {
			id: AssetRecordType.createId(getHashForString(url)),
			typeName: 'asset',
			type: 'bookmark',
			props: {
				src: url,
				title: meta?.title ?? '',
				description: meta?.description ?? '',
				image: meta?.image ?? '',
				favicon: meta?.favicon ?? '',
			},
			meta: {},
		}
	})
}

/*
 * Recorded clip video. The recording browser keeps its own copy (IndexedDB,
 * see videoStore.ts) and uploads it to Storage, so everyone in the room can
 * watch it: the clip then carries its address. A clip recorded earlier is
 * uploaded the next time the browser holding its video shows it.
 */
const sharing = new Set<string>()

export async function shareClipVideo(editor: Editor, clipId: TLShapeId, key: string, blob: Blob) {
	if (!storage || !key || sharing.has(key)) return
	sharing.add(key)
	try {
		// Named after the clip's video key: uploading twice (two tabs) writes the same file.
		const stored = await uploadBytes(ref(storage, `clips/${key.replace(/[^\w.-]/g, '-')}.webm`), blob, {
			contentType: blob.type || 'video/webm',
		})
		const videoUrl = await getDownloadURL(stored.ref)
		const clip = editor.getShape<ClipShape>(clipId)
		if (clip && clip.props.video === key && !clip.props.videoUrl)
			editor.run(() => editor.updateShape<ClipShape>({ id: clipId, type: CLIP_TYPE, props: { videoUrl } }), { history: 'ignore' })
	} catch (error) {
		console.warn('Could not upload the clip video; it stays on this computer for now', error)
		sharing.delete(key) // try again the next time the clip is shown
	}
}
