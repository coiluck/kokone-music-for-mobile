use lofty::config::WriteOptions;
use lofty::file::TaggedFileExt;
use lofty::probe::Probe;
use lofty::tag::{Accessor, Tag, TagExt};
use std::path::Path;

#[derive(serde::Deserialize)]
pub struct EditTrackPayload {
    pub path: String,
    pub title: String,
    pub artist: String,
    pub album: Option<String>,
}

#[tauri::command]
pub fn edit_track_metadata(payload: EditTrackPayload) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        let _ = payload;
        return Ok(());
    }

    #[cfg(not(target_os = "android"))]
    {
        let path = Path::new(&payload.path);
        let mut tagged_file = Probe::open(path)
            .map_err(|e| format!("probe failed: {e}"))?
            .read()
            .map_err(|e| format!("read failed: {e}"))?;

        if tagged_file.primary_tag().is_none() {
            let tag_type = tagged_file.primary_tag_type();
            tagged_file.insert_tag(Tag::new(tag_type));
        }
        let tag = tagged_file.primary_tag_mut().unwrap();

        tag.set_title(payload.title);
        tag.set_artist(payload.artist);
        match payload.album {
            Some(album) if !album.is_empty() => tag.set_album(album),
            _ => { tag.remove_album(); }
        }

        tag.save_to_path(path, WriteOptions::default())
            .map_err(|e| format!("save failed: {e}"))?;

        Ok(())
    }
}