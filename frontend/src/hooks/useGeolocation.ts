import { useState } from "react";

interface Location {
  latitude: number;
  longitude: number;
}

interface UseGeolocationReturn {
  location: Location | null;
  loading: Boolean;
  error: string | null;
  getCurrentLocation: () => void;
}

export const useGeolocation = (): UseGeolocationReturn => {
  const [location, setLocation] = useState<Location | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const getCurrentLocation = (): void => {
    setLoading(true);
    setError(null);

    if (!navigator.geolocation) {
      setError("Geolocation not supported");
      setLoading(false);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position: GeolocationPosition) => {
        setLocation({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
        setLoading(false);
      },
      (err: GeolocationPositionError) => {
        setError(err.message);
        setLoading(false);
        setLocation({ latitude: 40.7831, longitude: -73.9712 });
      },
    );
  };
  return { location, loading, error, getCurrentLocation };
};
