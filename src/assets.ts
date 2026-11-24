import { getDownloadURL, ref, uploadBytes } from 'firebase/storage'
import { AssetRecordType, Editor, TLAsset, TLAssetStore, getHashForString, uniqueId } from 'tldraw'
import { storage } from './firebase'

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
