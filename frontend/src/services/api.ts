import axios from "axios";

const API_BASE_URL = "http://localhost:3001/api";

export const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    "Content-Type": "application/json",
  },
});

export interface HealthResponse {
  message: string;
}

export const healthCheck = async (): Promise<HealthResponse> => {
  const response = await api.get<HealthResponse>("/health");
  return response.data;
};

export const getWalkingArea = async (lat: number, lng: number) => {
  const response = await api.post("/isochrone", { lat, lng });
  return response.data;
};

