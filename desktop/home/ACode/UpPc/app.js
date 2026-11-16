const count = document.getElementById("count");
let clicks = 0;

document.getElementById("clicker").addEventListener("click", () => {
    clicks++;
    count.textContent = clicks;
});
