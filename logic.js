(function (root) {
  'use strict';
  const normalize = value => String(value || '').toLocaleLowerCase('ru').replaceAll('ё', 'е').trim();
  function filterObservations(observations, filters = {}) {
    const query = normalize(filters.query);
    const values = Array.isArray(filters.species) ? filters.species : [filters.species];
    const selected = new Set(values.filter(value => value && value !== 'all').map(String));
    return observations.filter(o =>
      (!selected.size || selected.has(String(o.species_id))) &&
      (!filters.season || filters.season === 'all' || o.season === filters.season) &&
      (!query || normalize(o.name_ru + ' ' + o.name_sci).includes(query)));
  }
  function clusterKind(observations) {
    if (!observations.length) return {kind: 'empty', count: 0, speciesId: null};
    const speciesId = observations[0].species_id;
    const oneSpecies = observations.every(o => o.species_id === speciesId);
    return {kind: observations.length === 1 ? 'single' : oneSpecies ? 'one-species' : 'mixed', count: observations.length, speciesId: oneSpecies ? speciesId : null};
  }
  function countCells(observations) {
    const counts = new Map();
    for (const o of observations) counts.set(o.cell_id, (counts.get(o.cell_id) || 0) + 1);
    return counts;
  }
  const api = {filterObservations, clusterKind, countCells};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AtlasLogic = api;
})(typeof window !== 'undefined' ? window : globalThis);
