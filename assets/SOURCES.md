# Map sources

The geographic overlay uses the U.S. Census Bureau's 2024 state cartographic boundaries at 1:5,000,000. The 22 selected state geometries were transformed from NAD83 to WGS 84 and written as GeoJSON with five decimal places. The state postal abbreviation and name come from the original STUSPS and NAME attributes. Each label position is the centroid of the largest outer ring, checked to fall within the state. The label array uses Leaflet’s latitude, longitude order. The geographic geometries follow GeoJSON longitude, latitude order.

- [Census cartographic boundaries](https://www.census.gov/geographies/mapping-files/2024/geo/carto-boundary-file.html)
- [Original state shapefile](https://www2.census.gov/geo/tiger/GENZ2024/shp/cb_2024_us_state_5m.zip)
- Original ZIP SHA-256 `c9db0e395c11a1f94a8017fde4f4c7cbee1dca6eb37ba8f1ccaab927df70885f`

Leaflet 1.9.4 comes from the upstream npm release. The included JavaScript, CSS, images, source map and BSD 2-Clause license are unmodified. The JavaScript and stylesheet hashes match the release values on the [Leaflet download page](https://leafletjs.com/download.html). Retain vendor/leaflet/LICENSE when redistributing.

The interactive basemaps stream directly from their providers. Each tile service returned an image for the sample Western U.S. tile on November 22, 2026. Attribution should follow the active layer. Esri lists current contributors for [Dark Gray Canvas](https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer), [World Topographic Map](https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer), [Dark Gray Reference place names](https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer), and [World Imagery](https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer). The OpenStreetMap attribution is [© OpenStreetMap contributors](https://www.openstreetmap.org/copyright).

The offline terrain underlay, assets/western_relief.webp, uses Natural Earth Gray Earth with Shaded Relief, Hypsography and Flat Water at 1:50,000,000. The original raster was bilinearly reprojected into WGS 84 / Pseudo-Mercator (EPSG:3857), recolored with a monotone slate ramp, and masked to Natural Earth land and lake shorelines. The image is 1536 by 1244 pixels, with geographic corners 22°N, 140°W (southwest) and 56°N, 84°W (northeast). Those are the bounds for a Leaflet image overlay. The terrain appears beneath the live tiles. Natural Earth data are in the public domain.

- [Gray Earth source](https://naturalearth.s3.amazonaws.com/50m_raster/GRAY_50M_SR_W.zip)
- [Land](https://naturalearth.s3.amazonaws.com/50m_physical/ne_50m_land.zip) and [lake mask](https://naturalearth.s3.amazonaws.com/50m_physical/ne_50m_lakes.zip)
- [Natural Earth terms](https://www.naturalearthdata.com/about/terms-of-use/)
