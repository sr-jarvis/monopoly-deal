const Card = require("./Card.js");

class PropertyCard extends Card {
    type;
    imageLocation;

    constructor(title, value, type) {
        super(title, value);
        this.kind = "PROPERTY";
        this.type = type;
        this.color = type;
        var imageName = title.replace(" ", "");
        imageName = imageName.replace(" ", "");
        imageName = imageName.replace(" ", "");
        this.imageLocation = "assets/imgs/property_cards/" + imageName + ".png";
    }
}
module.exports = PropertyCard;
