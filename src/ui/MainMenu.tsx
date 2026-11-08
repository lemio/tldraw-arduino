import {
	AccessibilityMenu,
	ColorSchemeMenu,
	DefaultMainMenu,
	EditSubmenu,
	ExportFileContentSubMenu,
	ExtrasGroup,
	InputModeMenu,
	KeyboardShortcutsMenuItem,
	LanguageMenu,
	TldrawUiMenuCheckboxItem,
	TldrawUiMenuGroup,
	TldrawUiMenuSubmenu,
	ToggleDebugModeItem,
	ToggleDynamicSizeModeItem,
	ToggleEdgeScrollingItem,
	ToggleFocusModeItem,
	ToggleGridItem,
	TogglePasteAtCursorItem,
	ToggleSnapModeItem,
	ToggleToolLockItem,
	ToggleWrapModeItem,
	ViewSubmenu,
	useEditor,
	useValue,
} from 'tldraw'
import { isFanOutOn, setFanOut } from '../settings'
import { look, setLook } from '../style'

/** tldraw's main menu, with one extra preference next to its own. */
export function MainMenu() {
	return (
		<DefaultMainMenu>
			<TldrawUiMenuGroup id="basic">
				<EditSubmenu />
				<ViewSubmenu />
				<ExportFileContentSubMenu />
				<ExtrasGroup />
			</TldrawUiMenuGroup>
			<TldrawUiMenuGroup id="preferences">
				<TldrawUiMenuSubmenu id="preferences" label="menu.preferences">
					<TldrawUiMenuGroup id="preferences-actions">
						<ToggleSnapModeItem />
						<ToggleToolLockItem />
						<ToggleGridItem />
						<ToggleWrapModeItem />
						<ToggleFocusModeItem />
						<ToggleEdgeScrollingItem />
						<ToggleDynamicSizeModeItem />
						<TogglePasteAtCursorItem />
						<ToggleDebugModeItem />
					</TldrawUiMenuGroup>
					<TldrawUiMenuGroup id="wires">
						<ToggleFanOutItem />
						<ToggleClassicItem />
					</TldrawUiMenuGroup>
					<TldrawUiMenuGroup id="user-interface-submenus">
						<AccessibilityMenu />
						<InputModeMenu />
						<ColorSchemeMenu />
					</TldrawUiMenuGroup>
				</TldrawUiMenuSubmenu>
				<LanguageMenu />
				<KeyboardShortcutsMenuItem />
			</TldrawUiMenuGroup>
		</DefaultMainMenu>
	)
}

/** Just for you: the earlier look, with rounded cards and one accent blue. */
function ToggleClassicItem() {
	const classic = useValue('look', () => look.get() === 'classic', [])
	return (
		<TldrawUiMenuCheckboxItem
			id="classic-look"
			label="Classic look"
			checked={classic}
			readonlyOk
			onSelect={() => setLook(classic ? 'schematik' : 'classic')}
		/>
	)
}

/** Shared by the whole room: it changes how everyone's wires are drawn. */
function ToggleFanOutItem() {
	const editor = useEditor()
	const on = useValue('fan out', () => isFanOutOn(editor), [editor])
	return (
		<TldrawUiMenuCheckboxItem
			id="fan-out-wires"
			label="Fan out wires"
			checked={on}
			readonlyOk={false}
			onSelect={() => setFanOut(editor, !on)}
		/>
	)
}
