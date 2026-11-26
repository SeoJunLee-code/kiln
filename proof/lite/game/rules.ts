// The one rule components cannot express: the exit door opens once no #gem is left.
export default (k) => {
  k.component('door', 'closed exit door, removed when every #gem is collected', [{ name: 'id', type: 'int', def: 0 }]);
  k.system((w) => {
    if (w.match('#gem').length > 0) return;
    for (const id of w.query('door')) {
      w.emit('open');
      w.despawn(id);
    }
  });
};
