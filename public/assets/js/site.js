
document.addEventListener("DOMContentLoaded", function(){
  document.querySelectorAll('a[href^="#"]').forEach(function(a){
    a.addEventListener("click", function(e){
      var id = this.getAttribute("href");
      var el = document.querySelector(id);
      if(el){e.preventDefault();el.scrollIntoView({behavior:"smooth",block:"start"});}
    });
  });
});
