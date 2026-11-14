/**
 * Hệ môi trường: ngày/đêm, bốn mùa, thời tiết (mưa, hạn), mực nước.
 */
import {
  DROUGHT_CHANCE,
  DROUGHT_DURATION,
  RAIN_START_CHANCE,
  RAIN_STOP_CHANCE,
  SOIL_DRYING,
  SOIL_WETTING,
  TEMP_DAY_AMPLITUDE,
  TEMP_MEAN,
  TEMP_SEASON_AMPLITUDE,
  TICKS_PER_DAY,
  TICKS_PER_SEASON,
  TICKS_PER_YEAR,
  WATER_EVAPORATION,
  WATER_FIELD_INTERVAL,
  WATER_LEVEL_BASE,
  WATER_LEVEL_MAX,
  WATER_LEVEL_MIN,
  WATER_RAIN_GAIN,
  WATER_RELAXATION,
  WEATHER_INTERVAL,
} from './constants';
import { TWO_PI, clamp, clamp01, dsin } from './detmath';
import type { SimParams } from './params';
import type { Rng } from './rng';
import type { World } from './world';

/** Cập nhật khí hậu cho tick hiện tại. Gọi đầu mỗi tick. */
export function updateEnvironment(world: World, tick: number, params: SimParams, rng: Rng): void {
  const climate = world.climate;
  const yearTick = tick % TICKS_PER_YEAR;
  climate.yearPhase = yearTick / TICKS_PER_YEAR;
  climate.season = params.seasons ? Math.floor(yearTick / TICKS_PER_SEASON) : 1;
  // Đỉnh nóng giữa hạ (pha 0,375), đáy lạnh giữa đông (pha 0,875).
  climate.seasonal = params.seasons ? dsin(TWO_PI * (climate.yearPhase - 0.125)) : 0.5;

  const dayPhase = (tick % TICKS_PER_DAY) / TICKS_PER_DAY;
  const sun = dsin(TWO_PI * (dayPhase - 0.25)); // −1 nửa đêm, +1 giữa trưa
  climate.daylight = params.dayNight ? clamp01(0.5 + 0.85 * sun) : 1;

  climate.temperatureDaily =
    TEMP_MEAN +
    TEMP_SEASON_AMPLITUDE * climate.seasonal +
    params.temperatureOffset -
    (climate.rain > 0 ? 1.5 : 0);
  climate.temperature = climate.temperatureDaily + (params.dayNight ? TEMP_DAY_AMPLITUDE * sun : 0);
  // Nước có nhiệt dung lớn: dao động mùa của nó chỉ bằng ~60% của không khí và không đóng băng hẳn.
  climate.temperatureWater = Math.max(2, TEMP_MEAN + 0.6 * (climate.temperatureDaily - TEMP_MEAN));

  if (tick % WEATHER_INTERVAL === 0) updateWeather(world, params, rng);
  if (tick % WATER_FIELD_INTERVAL === 0 && Math.abs(climate.waterLevel - world.waterFieldLevel) > 0.0015) {
    world.updateWaterField();
  }
}

function updateWeather(world: World, params: SimParams, rng: Rng): void {
  const climate = world.climate;
  const dt = WEATHER_INTERVAL;
  if (climate.droughtTicks > 0) climate.droughtTicks = Math.max(0, climate.droughtTicks - dt);
  if (climate.floodTicks > 0) climate.floodTicks = Math.max(0, climate.floodTicks - dt);

  if (params.weather) {
    // Luôn rút đúng 3 số ngẫu nhiên mỗi chu kỳ để dãy RNG không phụ thuộc trạng thái thời tiết.
    const rollRain = rng.next();
    const rollDrought = rng.next();
    const rollLength = rng.next();
    if (climate.floodTicks > 0) {
      climate.rain = 1;
    } else if (climate.droughtTicks > 0) {
      climate.rain = 0;
    } else if (climate.rain > 0) {
      if (rollRain < RAIN_STOP_CHANCE) climate.rain = 0;
    } else if (rollRain < RAIN_START_CHANCE[climate.season] * params.rainfall) {
      climate.rain = 0.5 + 0.5 * rollLength;
    }
    if (climate.droughtTicks === 0 && climate.season === 1 && rollDrought < DROUGHT_CHANCE) {
      climate.droughtTicks = Math.floor(
        DROUGHT_DURATION[0] + (DROUGHT_DURATION[1] - DROUGHT_DURATION[0]) * rollLength,
      );
    }
  } else {
    climate.rain = 0;
  }

  // Bốc hơi mạnh hơn khi nóng; ~0 khi đóng băng.
  const evaporation = clamp(climate.temperatureDaily / 20, 0.05, 1.6);
  if (params.weather) {
    climate.soilWetness = clamp01(
      climate.soilWetness + SOIL_WETTING * climate.rain - SOIL_DRYING * evaporation * climate.soilWetness,
    );
    let level = climate.waterLevel;
    level += WATER_RAIN_GAIN * climate.rain * (climate.floodTicks > 0 ? 4 : 1);
    level -= WATER_EVAPORATION * evaporation * (climate.droughtTicks > 0 ? 3 : 1);
    // Sông thoát nước/nước ngầm bù lại: mực nước hồi dần về mực nền (chậm hơn nhiều khi đang hạn).
    level += WATER_RELAXATION * (climate.droughtTicks > 0 ? 0.15 : 1) * (WATER_LEVEL_BASE - level);
    climate.waterLevel = clamp(level, WATER_LEVEL_MIN, WATER_LEVEL_MAX);
  } else {
    climate.soilWetness = 0.6;
    climate.waterLevel = WATER_LEVEL_BASE;
  }
}
