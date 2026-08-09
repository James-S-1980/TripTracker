import catalog from "./airportCatalog.generated.json";
import type { Airport } from "./types";

// Generated from OurAirports data. Run `npm run generate:airports` to refresh.
export const generatedAirports: Airport[] = catalog as Airport[];
