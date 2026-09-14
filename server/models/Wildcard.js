const Card = require("./Card.js");
const PropertyType = require("./PropertyType.js");

class Wildcard extends Card {
    types;
    imageLocation;

    constructor(title, value, types) {
        super(title, value);
        this.kind = "WILDCARD";
        this.types = types;
        this.colors = types;
        var imageName;
        if (this.types.length == 2) {
            imageName = this.types[0] + "&" + this.types[1];
        } else {
            imageName = "All";
        }
        this.imageLocation = "assets/imgs/wildcards/" + imageName + ".png";
    }
}
module.exports = Wildcard;
