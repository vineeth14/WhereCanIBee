import { useEffect, useRef } from "react";

export const useSSEPOIUpdates = (
  category: 'restaurants' | 'recreation',
  isActive: boolean,
  currentPolygonHash: string,
  onPOIUpdate: (category: 'restaurants' | 'recreation', newPOIs: any[]) => void,
) => {
  const eventSourceRef = useRef<EventSource | null>(null);
  useEffect(() => {
    if (!isActive || !category || !currentPolygonHash) {
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
      return;
    }

    console.log(`Connecting to SSE for ${category}...`);

    const eventSource = new EventSource(
      `http://localhost:3001/api/pois/stream/${category}`,
    );
    eventSource.onopen = () => {
      console.log(`SSE connected for ${category}`);
    };
    
    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log(`SSE message received for ${category}:`, data);

        if (data.type === "poi_update" && data.polygon_hash === currentPolygonHash && data.pois.length > 0) {
          console.log(`Processing SSE update: ${data.pois.length} new ${category} POIs`);
          onPOIUpdate(category, data.pois);
        }
      } catch (parseError) {
        console.error('Failed to parse SSE message:', parseError);
      }
    };

    eventSource.onerror = (error) => {
      console.error(`SSE error for ${category}:`, error);
    };
    eventSourceRef.current = eventSource;

    return () => {
      console.log(`Disconnecting SSE for ${category}`);
      eventSource.close();
      eventSourceRef.current = null;
    };
  }, [category, isActive, currentPolygonHash, onPOIUpdate]);
};
