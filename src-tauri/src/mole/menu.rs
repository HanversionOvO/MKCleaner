//! Native context menus, built with AppKit directly.
//!
//! The tauri/muda menu stack paints menu icons from raw pixels — a coloured
//! Finder face pasted into the menu, which is not how macOS menus look. This
//! module builds the menu itself with `NSMenu` so the item can wear Finder's
//! icon in *template* form: AppKit then renders it the way every other menu
//! icon is rendered, tinted for the current appearance.
//!
//! AppKit UI belongs on the main thread; Tauri commands do not run there, so
//! the menu is built and popped via `run_on_main_thread`.

use std::sync::Mutex;

use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2::{define_class, msg_send, sel, MainThreadMarker, MainThreadOnly};
use objc2_app_kit::{NSApplication, NSEvent, NSImage, NSMenu, NSMenuItem, NSWorkspace};
use objc2_foundation::{NSString, NSSize, NSObject};
use tauri::{AppHandle, Emitter, Window};

use crate::error::{Error, Result};

/// The path the open menu item acts on. Set before each popup; the target's
/// action reads it. The action target itself lives only for the popup.
static PENDING_PATH: Mutex<Option<String>> = Mutex::new(Option::None);
static APP: Mutex<Option<AppHandle>> = Mutex::new(Option::None);

define_class!(
    #[unsafe(super(NSObject))]
    #[thread_kind = MainThreadOnly]
    struct RevealTarget;

    impl RevealTarget {
        #[unsafe(method(revealInFinder:))]
        fn reveal_in_finder(&self, _sender: &AnyObject) {
            let path = PENDING_PATH.lock().ok().and_then(|mut p| p.take());
            let app = APP.lock().ok().and_then(|a| a.clone());
            if let (Some(path), Some(app)) = (path, app) {
                let _ = app.emit("menu://reveal", path);
            }
        }
    }
);

impl RevealTarget {
    fn new(marker: MainThreadMarker) -> Retained<Self> {
        unsafe { msg_send![Self::alloc(marker), init] }
    }
}

/// Pops the native menu at the cursor.
#[tauri::command]
pub fn show_tile_menu(app: AppHandle, window: Window, path: String) -> Result<()> {
    // The menu appears on whatever window is key — the app is frontmost when
    // the user right-clicks in it, so that is our window.
    let _ = window;
    *PENDING_PATH
        .lock()
        .map_err(|_| Error::Other("menu lock poisoned".into()))? = Some(path);
    *APP.lock().map_err(|_| Error::Other("app lock poisoned".into()))? = Some(app.clone());

    app.run_on_main_thread(move || {
        let marker = MainThreadMarker::new().expect("run_on_main_thread runs on the main thread");

        let item = unsafe {
            NSMenuItem::initWithTitle_action_keyEquivalent(
                NSMenuItem::alloc(marker),
                &NSString::from_str("在 Finder 中打开"),
                Some(sel!(revealInFinder:)),
                &NSString::from_str(""),
            )
        };
        let target = RevealTarget::new(marker);
        unsafe { item.setTarget(Some(&target)) };
        if let Some(icon) = finder_icon(marker) {
            item.setImage(Some(&icon));
        }

        let menu = NSMenu::new(marker);
        menu.addItem(&item);

        let ns_app = NSApplication::sharedApplication(marker);
        let Some(key_window) = (unsafe { ns_app.keyWindow() }) else {
            eprintln!("[mkcleaner] no key window for the context menu");
            return;
        };
        let Some(view) = key_window.contentView() else {
            eprintln!("[mkcleaner] key window has no content view");
            return;
        };

        // NSEvent reports the cursor in screen coordinates (origin bottom-left);
        // the menu positions within the view's coordinates.
        let cursor = unsafe { NSEvent::mouseLocation() };
        let point = unsafe { key_window.convertPointFromScreen(cursor) };
        unsafe {
            menu.popUpMenuPositioningItem_atLocation_inView(None, point, Some(&view));
        }
    })
    .map_err(|e| Error::Other(format!("dispatching to the main thread: {e}")))
}

/// Finder's icon at the standard menu size, in colour — the same rendering
/// Finder's own "reveal in Finder" menu items use. (Template form does not
/// work here: the Finder face is a solid shape, so templating turns it into
/// a featureless block.)
fn finder_icon(marker: MainThreadMarker) -> Option<Retained<NSImage>> {
    let _ = marker;
    let workspace = unsafe { NSWorkspace::sharedWorkspace() };
    let image = unsafe {
        workspace.iconForFile(&NSString::from_str("/System/Library/CoreServices/Finder.app"))
    };
    unsafe { image.setSize(NSSize::new(16.0, 16.0)) };
    Some(image)
}
