(function(root){
  /* One release manifest drives the service-worker cache and the in-app
     What's New screen. Keep the newest release first. */
  root.SNAPFIT_RELEASES = [
    {
      version:"2.1.0",
      date:"2026-09-01",
      title:"A trainer after every set",
      summary:"SnapFit now coaches the set you just finished and gives you a clear target for the one that comes next.",
      changes:[
        "Post-set coaching now recommends whether to raise, hold or reduce the load — and explains why.",
        "Every recommendation includes a next-set rep target, a technique cue and rest guidance.",
        "Holding a weight is treated as productive progression when reps, control or effort are the next win.",
        "Away gyms can now pause the program for a standalone one-day session or adapt the next scheduled workout.",
        "A disrupted program week can be restarted without deleting its earlier workouts from the log.",
        "App updates now open this What's New screen once after the new version loads."
      ]
    }
  ];
})(globalThis);
