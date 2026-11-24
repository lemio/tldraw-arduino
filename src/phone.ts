/*
 * On a phone the canvas gets the whole screen: tldraw's menu is left out, the
 * palette starts folded away behind a button, and the view jumps to what is
 * on the canvas. Decided once, when the page opens.
 */

/** A small screen, or a touch screen that is narrow in one direction. */
export const isPhone =
	typeof matchMedia === 'function' &&
	matchMedia('(max-width: 700px), (pointer: coarse) and (max-height: 500px)').matches

if (isPhone) document.documentElement.classList.add('is-phone')
