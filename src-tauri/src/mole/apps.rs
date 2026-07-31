//! App icons, from AppKit.
//!
//! Reading `Contents/Resources/*.icns` does not work: modern apps keep their
//! icon in an asset catalog (`Assets.car`) with no loose `.icns` at all, and
//! `CFBundleIconFile` is empty for them. `NSWorkspace` resolves the icon the
//! same way Finder does, whichever form it takes, so that is what we ask.

use std::collections::HashMap;
use std::sync::Mutex;

use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep, NSWorkspace};
use objc2_foundation::{NSDictionary, NSSize, NSString};

/// Icons keyed by app path.
///
/// Every icon costs a trip through AppKit and a PNG encode, and the list is
/// re-rendered whenever the view remounts, so they are worth keeping.
static CACHE: Mutex<Option<HashMap<String, Option<String>>>> = Mutex::new(None);

/// Renders an app's icon as a PNG data URL, or `None` if AppKit has nothing.
pub fn icon_data_url(path: &str) -> Option<String> {
    if let Ok(mut guard) = CACHE.lock() {
        if let Some(hit) = guard.get_or_insert_with(HashMap::new).get(path) {
            return hit.clone();
        }
    }

    let rendered = render(path);

    if let Ok(mut guard) = CACHE.lock() {
        guard
            .get_or_insert_with(HashMap::new)
            .insert(path.to_string(), rendered.clone());
    }
    rendered
}

fn render(path: &str) -> Option<String> {
    // 128pt covers a retina 64pt tile without asking AppKit for a size it has
    // to upscale.
    let png = png_bytes(path, 128.0)?;
    Some(format!("data:image/png;base64,{}", base64(&png)))
}

/// RGBA pixels of an app's icon at the given size, for native menu items.
///
/// Tauri's `Image` takes raw RGBA rather than a decoded file, so AppKit hands
/// the pixels over directly instead of going through a PNG round trip.
pub fn app_icon_rgba(path: &str, size: f64) -> Option<(Vec<u8>, u32, u32)> {
    let workspace = unsafe { NSWorkspace::sharedWorkspace() };
    let image = unsafe { workspace.iconForFile(&NSString::from_str(path)) };
    unsafe { image.setSize(NSSize::new(size, size)) };

    let tiff = unsafe { image.TIFFRepresentation() }?;
    let rep = unsafe { NSBitmapImageRep::imageRepWithData(&tiff) }?;

    let width = unsafe { rep.pixelsWide() } as u32;
    let height = unsafe { rep.pixelsHigh() } as u32;
    let row_stride = unsafe { rep.bytesPerRow() } as usize;
    let data = unsafe { rep.bitmapData() };
    if width == 0 || height == 0 || data.is_null() {
        return None;
    }

    let mut rgba: Vec<u8> = Vec::with_capacity((height as usize) * (width as usize) * 4);
    for row in 0..height as usize {
        let src = unsafe { data.add(row * row_stride) };
        let dst = unsafe { rgba.as_mut_ptr().add(row * width as usize * 4) };
        unsafe {
            std::ptr::copy_nonoverlapping(src, dst, width as usize * 4);
        }
    }
    unsafe {
        rgba.set_len((height as usize) * (width as usize) * 4);
    }

    Some((rgba, width, height))
}

fn png_bytes(path: &str, size: f64) -> Option<Vec<u8>> {
    let workspace = unsafe { NSWorkspace::sharedWorkspace() };
    let image = unsafe { workspace.iconForFile(&NSString::from_str(path)) };
    unsafe { image.setSize(NSSize::new(size, size)) };

    let tiff = unsafe { image.TIFFRepresentation() }?;
    let rep = unsafe { NSBitmapImageRep::imageRepWithData(&tiff) }?;
    let data = unsafe {
        rep.representationUsingType_properties(NSBitmapImageFileType::PNG, &NSDictionary::new())
    }?;

    Some(data.to_vec())
}

const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/// Standard base64. A dependency for this alone is not worth carrying.
fn base64(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);

    for chunk in bytes.chunks(3) {
        let b = [
            chunk[0],
            *chunk.get(1).unwrap_or(&0),
            *chunk.get(2).unwrap_or(&0),
        ];
        let n = ((b[0] as u32) << 16) | ((b[1] as u32) << 8) | b[2] as u32;

        out.push(ALPHABET[(n >> 18) as usize & 63] as char);
        out.push(ALPHABET[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 {
            ALPHABET[(n >> 6) as usize & 63] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            ALPHABET[n as usize & 63] as char
        } else {
            '='
        });
    }

    out
}

#[cfg(test)]
mod tests {
    use super::base64;

    #[test]
    fn encodes_the_rfc_examples() {
        assert_eq!(base64(b""), "");
        assert_eq!(base64(b"f"), "Zg==");
        assert_eq!(base64(b"fo"), "Zm8=");
        assert_eq!(base64(b"foo"), "Zm9v");
        assert_eq!(base64(b"foob"), "Zm9vYg==");
        assert_eq!(base64(b"fooba"), "Zm9vYmE=");
        assert_eq!(base64(b"foobar"), "Zm9vYmFy");
    }

    #[test]
    fn encodes_bytes_that_are_not_text() {
        // The high bits and the 62/63 characters are where a hand-rolled
        // encoder usually goes wrong.
        assert_eq!(base64(&[0xff, 0xff, 0xff]), "////");
        assert_eq!(base64(&[0xfb, 0xff, 0xbf]), "+/+/");
        assert_eq!(base64(&[0x00, 0x00, 0x00]), "AAAA");
        assert_eq!(base64(&[0x89, 0x50, 0x4e, 0x47]), "iVBORw==");
    }

    /// Renders a real app icon through AppKit.
    ///
    /// Finder is always present, and the point is to prove the AppKit path
    /// produces a decodable PNG rather than an empty or truncated buffer —
    /// which is how this fails when the image representation is wrong.
    #[test]
    fn renders_a_real_app_icon_as_a_png() {
        let path = "/System/Library/CoreServices/Finder.app";
        if !std::path::Path::new(path).exists() {
            eprintln!("skipped: no Finder at {path}");
            return;
        }

        let png = super::png_bytes(path, 128.0).expect("AppKit returned an icon");
        assert!(png.len() > 1024, "png suspiciously small: {} bytes", png.len());
        assert_eq!(&png[..8], b"\x89PNG\r\n\x1a\n", "not a PNG");

        let url = super::icon_data_url(path).expect("data url");
        assert!(url.starts_with("data:image/png;base64,iVBORw0KGgo"));
    }

    /// Apps with only an asset catalog have no `.icns` to read, which is the
    /// case the old `sips` approach could not handle.
    #[test]
    fn renders_an_icon_for_an_app_with_no_icns() {
        let Some(path) = std::fs::read_dir("/Applications")
            .ok()
            .into_iter()
            .flatten()
            .flatten()
            .map(|e| e.path())
            .find(|p| {
                p.extension().is_some_and(|e| e == "app")
                    && p.join("Contents/Resources/Assets.car").is_file()
                    && std::fs::read_dir(p.join("Contents/Resources"))
                        .map(|mut r| {
                            !r.any(|f| {
                                f.is_ok_and(|f| {
                                    f.path().extension().is_some_and(|e| e == "icns")
                                })
                            })
                        })
                        .unwrap_or(false)
            })
        else {
            eprintln!("skipped: no asset-catalog-only app installed");
            return;
        };

        let png = super::png_bytes(&path.display().to_string(), 128.0)
            .unwrap_or_else(|| panic!("no icon for {}", path.display()));
        assert_eq!(&png[..8], b"\x89PNG\r\n\x1a\n", "not a PNG");
    }
}
