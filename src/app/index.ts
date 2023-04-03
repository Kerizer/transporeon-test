import * as express from 'express';
import * as morgan from 'morgan';

import { notNil, flatten, distanceBetween, haversine } from '../util';
import { Airport, Route, loadAirportData, loadRouteData } from '../data';

export async function createApp() {
  const app = express();

  const airports = await loadAirportData();
  const routes = await loadRouteData();
  const airportsByCode = new Map<string, Airport>(
    flatten(airports.map((airport) => [
      airport.iata !== null ? [airport.iata.toLowerCase(), airport] as const : null,
      airport.icao !== null ? [airport.icao.toLowerCase(), airport] as const : null,
    ].filter(notNil)))
  );

  app.use(morgan('tiny'));

  app.get('/health', (_, res) => res.send('OK'));
  app.get('/airports/:code', (req, res) => {
    const code = req.params['code'];
    if (code === undefined) {
      return res.status(400).send('Must provide airport code');
    }

    const airport = airportsByCode.get(code.toLowerCase());
    if (airport === undefined) {
      return res.status(404).send('No such airport, please provide a valid IATA/ICAO code');
    }

    return res.status(200).send(airport);
  });

  app.get('/routes-test/:source', (req, res) => {
    const source = req.params['source'];
    
    if (source === undefined) {
      return res.status(400).send('Must provide source airport');
    }
  
    const sourceAirport = airportsByCode.get(source.toLowerCase());

    const sourceRoutes = routes.filter((route) => route.source.id === sourceAirport.id);
    return res.status(200).send(sourceRoutes);
  })

  app.get('/routes/:source/:destination', (req, res) => {
    const source = req.params['source'];
    const destination = req.params['destination'];
    const maxStops = 3;
  
    if (source === undefined || destination === undefined) {
      return res.status(400).send('Must provide source and destination airports');
    }
  
    const sourceAirport = airportsByCode.get(source.toLowerCase());
    const destinationAirport = airportsByCode.get(destination.toLowerCase());
    if (sourceAirport === undefined || destinationAirport === undefined) {
      return res.status(404).send('No such airport, please provide a valid IATA/ICAO codes');
    }
  
    // Find all routes from the source airport
    const sourceRoutes = routes.filter((route) => route.source.id === sourceAirport.id);
    const validRoutes: Route[][] = [];
  
    // For each route from the source, find all possible combinations of up to maxStops flights
    for (const sourceRoute of sourceRoutes) {
      const hops: Route[] = [sourceRoute];
  
      for (let stops = 1; stops <= maxStops; stops++) {
        const lastHop = hops[hops.length - 1];
        const nextRoutes = routes.filter((route) => route.source.id === lastHop.destination.id);
  
        for (const nextRoute of nextRoutes) {
          if (hops.some((hop) => hop.source.id === nextRoute.source.id)) {
            // Avoid cycles
            continue;
          }
  
          hops.push(nextRoute);
  
          if (nextRoute.destination.id === destinationAirport.id) {
            // Found a valid route to the destination
            validRoutes.push([...hops]);
          } else if (stops < maxStops) {
            // Keep looking for routes with more stops
            continue;
          }
  
          hops.pop();
        }
      }
    }
  
    if (validRoutes.length === 0) {
      // No valid routes found
      return res.status(404).send('No valid routes found');
    }
  
    // Find the shortest valid route
    const shortestRoute = validRoutes.reduce((shortest, route) => {
      const distance = route.reduce((sum, hop) => sum + hop.distance, 0);
      return distance < shortest.distance ? { distance, route } : shortest;
    }, { distance: Infinity, route: [] });
  
    const hops = shortestRoute.route.map((route) => {
      return {
        source: route.source.iata || route.source.icao,
        destination: route.destination.iata || route.destination.icao,
        distance: route.distance,
      };
    });
  
    return res.status(200).send({
      source: sourceAirport.iata || sourceAirport.icao,
      destination: destinationAirport.iata || destinationAirport.icao,
      distance: shortestRoute.distance,
      hops,
    });
  });

  return app;
}
