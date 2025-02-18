console.log("This is from popup");

const submit_btn = document.getElementById('submit'); // or querySelector('.class')
submit_btn.addEventListener('click', function() {
    console.log("Button clicked");
});
