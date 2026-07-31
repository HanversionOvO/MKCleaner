//! Byte-size helpers for the human-readable sizes the Mole engine prints.
//!
//! The engine formats sizes like `0B`, `1KB`, `38.6MB`, `1.42GB`, and uses `--`
//! when a size is unknown. Everything crossing into the frontend is a plain byte
//! count; formatting for display happens once, in the UI.

/// Parses a Mole size string into bytes. Returns `None` for `--` and anything
/// that does not look like a size, so callers can distinguish "unknown" from 0.
pub fn parse(input: &str) -> Option<u64> {
    let s = input.trim();
    if s.is_empty() || s == "--" {
        return None;
    }

    let split = s
        .find(|c: char| c.is_ascii_alphabetic())
        .unwrap_or(s.len());
    let (number, unit) = s.split_at(split);

    let value: f64 = number.trim().parse().ok()?;
    // Mole derives every size from 1024-based arithmetic (see MOLE_ONE_GIB_KB),
    // so KB/MB/GB here are KiB/MiB/GiB.
    let multiplier: f64 = match unit.trim().to_ascii_uppercase().as_str() {
        "B" | "" => 1.0,
        "K" | "KB" => 1024.0,
        "M" | "MB" => 1024.0 * 1024.0,
        "G" | "GB" => 1024.0 * 1024.0 * 1024.0,
        "T" | "TB" => 1024.0 * 1024.0 * 1024.0 * 1024.0,
        _ => return None,
    };

    let bytes = value * multiplier;
    if bytes.is_finite() && bytes >= 0.0 {
        Some(bytes.round() as u64)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::parse;

    #[test]
    fn parses_the_forms_mole_emits() {
        assert_eq!(parse("0B"), Some(0));
        assert_eq!(parse("1KB"), Some(1024));
        assert_eq!(parse("38.6MB"), Some(40475034));
        assert_eq!(parse("1.42GB"), Some(1524713390));
        assert_eq!(parse("  2.4MB  "), Some(2516582));
    }

    #[test]
    fn unknown_sizes_are_none_not_zero() {
        assert_eq!(parse("--"), None);
        assert_eq!(parse(""), None);
        assert_eq!(parse("many"), None);
        assert_eq!(parse("12PB"), None);
    }
}
