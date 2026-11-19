//! Reading and writing text files in encodings other than UTF-8.
//!
//! Opening a file detects its encoding: a byte-order mark wins, then valid
//! UTF-8, then a statistical guess (`chardetng`, the detector Firefox uses).
//! The encoding travels with the tab and is used again when saving, so a
//! Latin-1 or UTF-16 file is written back the way it was found.

use std::fs;

use encoding_rs::{Encoding, UTF_16BE, UTF_16LE, UTF_8};
use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DecodedText {
    text: String,
    /// WHATWG encoding name, e.g. `UTF-8`, `UTF-16LE`, `windows-1252`.
    encoding: String,
    /// Whether the file starts with a byte-order mark.
    bom: bool,
    /// Some bytes were not valid in this encoding and were replaced with U+FFFD.
    lossy: bool,
}

fn lookup(label: &str) -> Result<&'static Encoding, String> {
    Encoding::for_label(label.as_bytes()).ok_or_else(|| format!("Unknown encoding: {label}"))
}

fn detect(bytes: &[u8]) -> Result<&'static Encoding, String> {
    if std::str::from_utf8(bytes).is_ok() {
        return Ok(UTF_8);
    }
    // Not UTF-8 and full of NULs: an image, archive or other binary.
    if bytes.iter().take(8192).any(|&b| b == 0) {
        return Err("it looks like a binary file, not text".to_string());
    }
    let mut detector = chardetng::EncodingDetector::new(chardetng::Iso2022JpDetection::Deny);
    detector.feed(bytes, true);
    Ok(detector.guess(None, chardetng::Utf8Detection::Deny))
}

fn decode(bytes: &[u8], forced: Option<&str>) -> Result<DecodedText, String> {
    let sniffed = Encoding::for_bom(bytes);
    let (encoding, bom_len) = match forced {
        Some(label) => {
            let encoding = lookup(label)?;
            // Only skip a BOM that belongs to the encoding asked for.
            let bom_len = sniffed.filter(|(e, _)| *e == encoding).map_or(0, |(_, n)| n);
            (encoding, bom_len)
        }
        None => match sniffed {
            Some((encoding, n)) => (encoding, n),
            None => (detect(bytes)?, 0),
        },
    };
    let (text, lossy) = encoding.decode_without_bom_handling(&bytes[bom_len..]);
    Ok(DecodedText {
        text: text.into_owned(),
        encoding: encoding.name().to_string(),
        bom: bom_len > 0,
        lossy,
    })
}

fn encode(text: &str, label: &str, bom: bool) -> Result<Vec<u8>, String> {
    let encoding = lookup(label)?;
    let mut out = Vec::with_capacity(text.len() + 3);

    // encoding_rs only decodes UTF-16, so write it by hand.
    if encoding == UTF_16LE || encoding == UTF_16BE {
        let to_bytes: fn(u16) -> [u8; 2] = if encoding == UTF_16LE {
            u16::to_le_bytes
        } else {
            u16::to_be_bytes
        };
        if bom {
            out.extend_from_slice(&to_bytes(0xFEFF));
        }
        for unit in text.encode_utf16() {
            out.extend_from_slice(&to_bytes(unit));
        }
        return Ok(out);
    }

    if bom && encoding == UTF_8 {
        out.extend_from_slice(&[0xEF, 0xBB, 0xBF]);
    }
    let (bytes, _, unmappable) = encoding.encode(text);
    if unmappable {
        return Err(format!(
            "it contains characters that {} cannot represent",
            encoding.name()
        ));
    }
    out.extend_from_slice(&bytes);
    Ok(out)
}

/// Read a text file, detecting its encoding unless one is given.
#[tauri::command]
pub async fn read_text_file(path: String, encoding: Option<String>) -> Result<DecodedText, String> {
    let bytes = fs::read(&path).map_err(|e| e.to_string())?;
    decode(&bytes, encoding.as_deref())
}

/// Write a text file in the given encoding. Fails, leaving the file alone, if
/// the text has characters the encoding cannot represent.
#[tauri::command]
pub async fn write_text_file(
    path: String,
    text: String,
    encoding: String,
    bom: bool,
) -> Result<(), String> {
    let bytes = encode(&text, &encoding, bom)?;
    fs::write(&path, bytes).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_utf8_bom_and_legacy_encodings() {
        let d = decode("héllo".as_bytes(), None).unwrap();
        assert_eq!((d.encoding.as_str(), d.bom, d.lossy), ("UTF-8", false, false));

        let d = decode(b"\xEF\xBB\xBFhi", None).unwrap();
        assert_eq!((d.text.as_str(), d.encoding.as_str(), d.bom), ("hi", "UTF-8", true));

        let d = decode(b"\xFF\xFEh\x00i\x00", None).unwrap();
        assert_eq!((d.text.as_str(), d.encoding.as_str(), d.bom), ("hi", "UTF-16LE", true));

        // "Les élèves ont été reçus à l'école." in Latin-1
        let latin1 = b"Les \xE9l\xE8ves ont \xE9t\xE9 re\xE7us \xE0 l'\xE9cole.";
        let d = decode(latin1, None).unwrap();
        assert_eq!(d.text, "Les élèves ont été reçus à l'école.");
        assert_eq!((d.encoding.as_str(), d.lossy), ("windows-1252", false));
    }

    #[test]
    fn refuses_binary() {
        assert!(decode(b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\xff\xfe\xfd", None).is_err());
    }

    #[test]
    fn forced_encoding_overrides_detection() {
        let d = decode(b"\xE9", Some("windows-1251")).unwrap();
        assert_eq!(d.text, "й");
        let d = decode(b"\xE9", Some("UTF-8")).unwrap();
        assert!(d.lossy);
    }

    #[test]
    fn round_trips() {
        for (label, bom) in [
            ("UTF-8", false),
            ("UTF-8", true),
            ("UTF-16LE", true),
            ("UTF-16BE", true),
            ("UTF-16LE", false),
            ("windows-1252", false),
        ] {
            let bytes = encode("café\n", label, bom).unwrap();
            let d = decode(&bytes, Some(label)).unwrap();
            assert_eq!((d.text.as_str(), d.bom, d.lossy), ("café\n", bom, false), "{label}");
        }
        assert_eq!(encode("é", "windows-1252", false).unwrap(), b"\xE9");
        assert_eq!(encode("a", "UTF-16BE", true).unwrap(), b"\xFE\xFF\x00a");
    }

    #[test]
    fn refuses_unmappable_characters() {
        assert!(encode("日本語", "windows-1252", false).is_err());
        assert!(encode("日本語", "Shift_JIS", false).is_ok());
    }
}
