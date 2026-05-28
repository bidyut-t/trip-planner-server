import { Router } from "express";
import { getWeatherSummary } from "../services/weather.service.js";

export const weatherRouter = Router();

weatherRouter.get("/summary", async (req, res) => {
  try {
    const { latitude, longitude, start_date, end_date } = req.query;

    if (!latitude || !longitude || !start_date || !end_date) {
      return res.status(400).json({
        error: "latitude, longitude, start_date, end_date are required",
      });
    }

    const result = await getWeatherSummary({
      latitude: latitude as string,
      longitude: longitude as string,
      start_date: start_date as string,
      end_date: end_date as string,
    });

    res.json(result);
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Failed to fetch weather data",
    });
  }
});
