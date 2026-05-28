interface WeatherParams {
  latitude: string;
  longitude: string;
  start_date: string;
  end_date: string;
}

interface WeatherResult {
  location: { latitude: string; longitude: string };
  range: { start_date: string; end_date: string };
  summary: string;
  weather: Record<string, unknown>;
}

export async function getWeatherSummary(
  params: WeatherParams,
): Promise<WeatherResult> {
  const { latitude, longitude, start_date, end_date } = params;

  const url =
    process.env.OPEN_METEO_API_URL +
    `?latitude=${latitude}` +
    `&longitude=${longitude}` +
    `&start_date=${start_date}` +
    `&end_date=${end_date}` +
    `&daily=` +
    `temperature_2m_max,temperature_2m_min,precipitation_sum` +
    `&timezone=auto`;

  const response = await fetch(url);
  const data = await response.json();

  const daily = data.daily;

  const maxTemps: number[] = daily.temperature_2m_max;
  const rain: number[] = daily.precipitation_sum;

  const avgMax = maxTemps.reduce((a, b) => a + b, 0) / maxTemps.length;
  const totalRain = rain.reduce((a, b) => a + b, 0);

  let summary = "";

  if (avgMax > 35) {
    summary += "Very hot weather expected. ";
  } else if (avgMax > 28) {
    summary += "Warm temperatures overall. ";
  } else {
    summary += "Cool to moderate temperatures. ";
  }

  if (totalRain > 20) {
    summary += "Heavy rainfall during this period.";
  } else if (totalRain > 5) {
    summary += "Some rain expected.";
  } else {
    summary += "Mostly dry conditions.";
  }

  return {
    location: { latitude, longitude },
    range: { start_date, end_date },
    summary,
    weather: daily,
  };
}
