import { useEffect } from 'react'
import {
	DefaultContextMenu,
	DefaultContextMenuContent,
	Editor,
	TLBookmarkShape,
	TLEmbedShape,
	TLShapeId,
	TLUiContextMenuProps,
	TldrawUiMenuGroup,
	TldrawUiMenuItem,
	createShapeId,
	defaultHandleExternalUrlContent,
	useEditor,
	useToasts,
	useTranslation,
	useValue,
} from 'tldraw'

/*
 * Links as web pages. A pasted link becomes a link card, as in tldraw; links
 * tldraw knows how to embed (YouTube, Figma, Google Maps…) still embed. For
 * any other link a notice offers to show the page itself instead, live in an
 * iframe, and so does the right-click menu of a link card. Double-click the
 * page to use it. Many sites refuse to be shown inside another site; those
 * stay blank, and the menu turns them back into a card.
 */

/** Size of a new web page on the canvas. */
const PAGE = { w: 720, h: 480 }

/** Replaces a link card with the page itself, where the card was. */
export function showAsWebPage(editor: Editor, id: TLShapeId) {
	const card = editor.getShape<TLBookmarkShape>(id)
	if (!card || card.type !== 'bookmark' || !card.props.url) return
	const page = createShapeId()
	editor.markHistoryStoppingPoint('show as web page')
	editor.run(() => {
		editor.createShape<TLEmbedShape>({
			id: page,
			type: 'embed',
			x: card.x,
			y: card.y,
			props: { url: card.props.url, ...PAGE },
		})
		editor.deleteShape(card.id)
		editor.select(page)
	})
}

const knownEmbed = (editor: Editor, url: string) =>
	!!(editor.getShapeUtil('embed') as { getEmbedDefinition?(u: string): unknown } | undefined)?.getEmbedDefinition?.(url)

/** Pasted links: a card first, with the choice of the page itself. Lives with the editor's UI, for its notices. */
export function WebPageLinks() {
	const editor = useEditor()
	const toasts = useToasts()
	const msg = useTranslation()

	useEffect(() => {
		editor.registerExternalContentHandler('url', async ({ point, url, shapeId }) => {
			await defaultHandleExternalUrlContent(editor, { point, url, shapeId }, { toasts, msg })
			// Pasted onto a shape, or a site tldraw embeds itself: nothing to choose.
			if (shapeId || knownEmbed(editor, url)) return
			const card = editor.getOnlySelectedShape()
			if (card?.type !== 'bookmark') return
			toasts.addToast({
				title: 'Link added as a card',
				description: 'Or show the page itself, live on the canvas. Some sites don’t allow that and stay blank.',
				actions: [{ type: 'primary', label: 'Show as web page', onClick: () => showAsWebPage(editor, card.id) }],
			})
		})
	}, [editor, toasts, msg])

	return null
}

/** tldraw's right-click menu, with "Show as web page" for a selected link card. */
export function ContextMenu(props: TLUiContextMenuProps) {
	return (
		<DefaultContextMenu {...props}>
			<ShowAsWebPageItem />
			<DefaultContextMenuContent />
		</DefaultContextMenu>
	)
}

function ShowAsWebPageItem() {
	const editor = useEditor()
	const card = useValue(
		'link card',
		() => {
			const s = editor.getOnlySelectedShape()
			return s?.type === 'bookmark' && (s as TLBookmarkShape).props.url && !knownEmbed(editor, (s as TLBookmarkShape).props.url)
				? s.id
				: null
		},
		[editor]
	)
	if (!card) return null
	return (
		<TldrawUiMenuGroup id="web-page">
			<TldrawUiMenuItem id="show-as-web-page" label="Show as web page" icon="external-link" onSelect={() => showAsWebPage(editor, card)} />
		</TldrawUiMenuGroup>
	)
}
