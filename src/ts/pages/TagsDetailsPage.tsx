import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom'
import { Track, getTagslists, getTagListTracks } from '../lib/db';
import type { PlaylistIcon as PlaylistIconData } from '../lib/playlistIcon'

export default function TagsDetailsPage() {
  const { listName } = useParams<{ listName: string }>()
  const navigate = useNavigate;

  const [tracks, setTracks] = useState<Track[]>([])
  const [icon, setIcon] = useState<PlaylistIconData | null>(null)
  
  useEffect(() => {
    const fetchData = async () => {
      const allLists = await getTagslists();
      const targetList = allLists.find(item => item.name === listName);
      if (!targetList) return;
    
      setIcon(targetList.icon);
      const tracks = await getTagListTracks(targetList.positive_tags, targetList.negative_tags);
      setTracks(tracks);
    };
    fetchData();
  }, []);

  return (
    <p>{listName}</p>
  )
}